# -*- coding: utf-8 -*-
"""Per-game timeline card — all three markets, release to now.

    py -X utf8 tools/game_timeline_card.py [outdir] [week]

One PNG per Week-N game (default week 0): SPREAD / TOTAL / MONEYLINE step
charts stacked on one dark card — the picked side's number through time,
segments colored by the grade held (No Edge included), dotted connector +
gold diamond where the pick changed sides. Markets with no pick row say so.
Data: the public game-breakdown endpoint + the public games table.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

S = 2
W = 1080 * S
PAD = 56 * S

INK = (15, 14, 10)
CREAM = (248, 245, 238)
GOLD = (184, 146, 42)
GOLD_LIGHT = (231, 190, 77)
TEXT_LIGHT = (163, 154, 136)
DIVIDER = (45, 44, 40)
SILVER = (192, 197, 204)
BRONZE = (169, 103, 58)
DIM = (110, 104, 90)

TIER_COL = {"A+": GOLD_LIGHT, "A": GOLD, "B": SILVER, "C": BRONZE,
            "no_edge": DIM, None: DIM}
TIER_LABEL = {"A+": "A+", "A": "A", "B": "B", "C": "C", "no_edge": "No Edge"}
ET = ZoneInfo("America/New_York")
ANON = "sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE"   # public by design

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow   = font("seguisb.ttf", 16)
f_title     = font("georgiab.ttf", 54)
f_kick      = font("segoeui.ttf", 17)
f_mkt       = font("seguisb.ttf", 15)
f_end       = font("seguisb.ttf", 15)
f_day       = font("seguisb.ttf", 13)
f_note      = font("segoeui.ttf", 16)
f_footurl   = font("georgiab.ttf", 24)
f_footnote  = font("seguisb.ttf", 13)


def jget(url):
    return json.load(urllib.request.urlopen(url, timeout=60))


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(ET)


def num(v):
    try:
        return float(str(v).replace("+", ""))
    except (TypeError, ValueError):
        return None


def segments(p):
    h = (p or {}).get("history") or {}
    rel = h.get("released") or {}
    if not rel.get("at"):
        return []
    segs = [(parse_ts(rel["at"]), rel.get("side"), num(rel.get("line")),
             rel.get("line"), rel.get("tier"))]
    for t in h.get("transitions") or []:
        segs.append((parse_ts(t["observed_at"]), t.get("side"),
                     num(t.get("line")), t.get("line"), t.get("tier")))
    return segs


def draw_card(gid, matchup, kick_txt, picks, out_path):
    now = datetime.now(ET)
    all_segs = {mk: segments(picks.get(mk)) for mk in
                ("spread", "total", "moneyline")}
    starts = [s[0][0] for s in all_segs.values() if s]
    if not starts:
        return False
    t_min = min(starts)
    span = (now - t_min).total_seconds()

    img = Image.new("RGB", (W, 2200 * S), INK)
    dr = ImageDraw.Draw(img)

    y = 40 * S
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    if os.path.exists(lp):
        lg = Image.open(lp).convert("RGBA")
        h_ = 84 * S
        lg = lg.resize((int(lg.width * h_ / lg.height), h_), Image.LANCZOS)
        img.paste(lg, (PAD, y), lg)
    dr.text((W - PAD, y + 62 * S), "COLLEGE FOOTBALL · 2026",
            font=f_day, fill=TEXT_LIGHT, anchor="rs")
    y += 84 * S + 20 * S

    dr.text((PAD, y), "EVERY MOVE, ON THE RECORD · WEEK 0", font=f_eyebrow,
            fill=GOLD_LIGHT)
    y += 26 * S
    dr.text((PAD, y), matchup, font=f_title, fill=CREAM)
    y += 74 * S
    if kick_txt:
        dr.text((PAD, y), kick_txt, font=f_kick, fill=TEXT_LIGHT)
        y += 28 * S
    y += 4 * S
    dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
    y += 16 * S

    gx0, gx1 = PAD + 8 * S, W - PAD - 235 * S

    def X(dt):
        return gx0 + (gx1 - gx0) * ((dt - t_min).total_seconds() / span)

    day = datetime(t_min.year, t_min.month, t_min.day, tzinfo=ET)
    ticks = []
    while day <= now:
        ticks.append(max(day, t_min))
        day += timedelta(days=1)
    for tk in ticks:
        dr.text((X(tk), y + 14 * S), f"{tk.month}/{tk.day}", font=f_day,
                fill=TEXT_LIGHT, anchor="ms")
    dr.text((gx1 + 12 * S, y + 14 * S), "NOW", font=f_day, fill=GOLD_LIGHT,
            anchor="ls")
    y += 28 * S

    CH = 96 * S
    for mk, label in (("spread", "SPREAD"), ("total", "TOTAL"),
                      ("moneyline", "MONEYLINE")):
        p = picks.get(mk)
        segs = all_segs[mk]
        dr.text((PAD, y + 16 * S), label, font=f_mkt, fill=GOLD_LIGHT,
                anchor="ls")
        if not segs:
            dr.text((PAD + 140 * S, y + 16 * S),
                    "no board for this market", font=f_note,
                    fill=TEXT_LIGHT, anchor="ls")
            y += 30 * S
            dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
            y += 16 * S
            continue
        y += 26 * S

        vals = [v for _, _, v, _, _ in segs if v is not None]
        lo, hi = min(vals), max(vals)
        if hi - lo < 1e-9:
            lo -= 1.0
            hi += 1.0
        padv = (hi - lo) * 0.22
        lo, hi = lo - padv, hi + padv

        def Y(v):
            return y + CH - (CH * (v - lo) / (hi - lo))

        for tk in ticks:
            dr.line([X(tk), y, X(tk), y + CH], fill=DIVIDER, width=1)
        _labels = []
        _flips = []

        ext = segs + [(now, segs[-1][1], segs[-1][2], segs[-1][3],
                       segs[-1][4])]
        for i in range(len(segs)):
            t0_, side0, v0, _, tier0 = ext[i]
            t1_ = ext[i + 1][0]
            if v0 is None:
                continue
            col = TIER_COL.get(tier0, DIM)
            if tier0 == "A+":
                # hollow gold track — the ink-core-with-gold-border badge,
                # as a line ("a and a+ are virtually the same color")
                dr.line([X(t0_), Y(v0), X(t1_), Y(v0)], fill=GOLD_LIGHT,
                        width=8 * S)
                dr.line([X(t0_), Y(v0), X(t1_), Y(v0)], fill=INK,
                        width=3 * S)
            else:
                dr.line([X(t0_), Y(v0), X(t1_), Y(v0)], fill=col, width=4 * S)
            nxt = ext[i + 1]
            if i + 1 < len(segs) and nxt[2] is not None:
                if nxt[1] != side0:
                    ya, yb = sorted([Y(v0), Y(nxt[2])])
                    yy_ = ya
                    while yy_ < yb:
                        dr.line([X(t1_), yy_, X(t1_), min(yy_ + 5 * S, yb)],
                                fill=DIM, width=1 * S)
                        yy_ += 10 * S
                    _flips.append((X(t1_), (Y(v0) + Y(nxt[2])) / 2,
                                   f"→ {nxt[1]} {nxt[3]}"))
                else:
                    dr.line([X(t1_), Y(v0), X(t1_), Y(nxt[2])],
                            fill=TIER_COL.get(nxt[4], DIM), width=2 * S)

        rel = segs[0]
        last = segs[-1]
        _rel_txt = (f"Released · {rel[1]} {rel[3]} · "
                    f"{TIER_LABEL.get(rel[4], '')}")
        _rel_y = (y + CH - 8 * S) if (rel[2] is not None and
                                      Y(rel[2]) < y + CH / 2) else (y + 12 * S)
        dr.text((gx0 + 4 * S, _rel_y), _rel_txt, font=f_day,
                fill=TEXT_LIGHT, anchor="ls")
        _labels.append((gx0 + 4 * S, _rel_y - 22 * S,
                        gx0 + 4 * S + dr.textlength(_rel_txt, font=f_day),
                        _rel_y + 6 * S))

        # diamonds first — every one a no-go box for text
        for cx, cy, _txt in _flips:
            r = 7 * S
            dr.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r),
                        (cx - r, cy)], fill=GOLD_LIGHT)
            _labels.append((cx - 11 * S, cy - 11 * S, cx + 11 * S,
                            cy + 11 * S))
        # labels only where a flip has room (a crowded cluster keeps its
        # diamonds; Released tag + the Now gutter carry the endpoints)
        for cx, cy, _txt in _flips:
            if any(abs(cx - ox) < 80 * S and (ox, oy) != (cx, cy)
                   for ox, oy, _ in _flips):
                continue
            _tw = dr.textlength(_txt, font=f_day)
            for _lx, _ly, _anch in ((cx + 14 * S, cy + 5 * S, "ls"),
                                    (cx + 14 * S, cy - 16 * S, "ls"),
                                    (cx - 14 * S, cy + 5 * S, "rs")):
                _x0 = _lx if _anch == "ls" else _lx - _tw
                if _x0 + _tw > gx1 - 4 * S or _x0 < gx0:
                    continue
                _box = (_x0, _ly - 22 * S, _x0 + _tw, _ly + 6 * S)
                if all(_box[2] < b[0] or _box[0] > b[2] or
                       _box[3] < b[1] or _box[1] > b[3] for b in _labels):
                    dr.text((_lx, _ly), _txt, font=f_day,
                            fill=GOLD_LIGHT, anchor=_anch)
                    _labels.append(_box)
                    break

        tier_now = (p or {}).get("tier")
        end_y = Y(last[2]) + 5 * S if last[2] is not None else y + CH // 2
        dr.text((gx1 + 12 * S, end_y),
                f"{last[1]} {last[3]} · {TIER_LABEL.get(tier_now, '')}",
                font=f_end, fill=CREAM, anchor="ls")

        y += CH + 14 * S
        dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
        y += 16 * S

    lx = PAD
    for tier in ("A+", "A", "B", "C", "no_edge"):
        if tier == "A+":
            dr.rectangle([lx, y + 4 * S, lx + 26 * S, y + 14 * S],
                         fill=GOLD_LIGHT)
            dr.rectangle([lx + 2 * S, y + 7 * S, lx + 24 * S, y + 11 * S],
                         fill=INK)
        else:
            dr.rectangle([lx, y + 6 * S, lx + 26 * S, y + 12 * S],
                         fill=TIER_COL[tier])
        lbl = TIER_LABEL[tier]
        dr.text((lx + 32 * S, y + 14 * S), lbl, font=f_day, fill=TEXT_LIGHT,
                anchor="ls")
        lx += 32 * S + int(dr.textlength(lbl, font=f_day)) + 26 * S
    _dw = dr.textlength("pick changed sides", font=f_day)
    _dx = W - PAD - _dw - 18 * S
    dr.polygon([(_dx, y + 4 * S), (_dx + 6 * S, y + 10 * S),
                (_dx, y + 16 * S), (_dx - 6 * S, y + 10 * S)],
               fill=GOLD_LIGHT)
    dr.text((W - PAD, y + 14 * S), "pick changed sides", font=f_day,
            fill=TEXT_LIGHT, anchor="rs")
    y += 34 * S

    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 24 * S
    dr.text((PAD, fy + 22 * S), "pressboxanalytics.com", font=f_footurl,
            fill=GOLD_LIGHT, anchor="ls")
    dr.text((W - PAD, fy + 20 * S), "EVERY NUMBER AS IT STOOD",
            font=f_footnote, fill=TEXT_LIGHT, anchor="rs")

    img.crop((0, 0, W, fy + 48 * S)).save(out_path, "PNG")
    return True


def main():
    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    week = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    os.makedirs(outdir, exist_ok=True)

    # Week slate from the public games table (anchor Saturday window comes
    # from the picks' own week field on the feed; here the Week-0 window).
    if week == 0:
        lo, hi = "2026-08-26", "2026-09-01"
    else:
        base = datetime(2026, 8, 29) + timedelta(days=7 * (week))
        lo = (base - timedelta(days=3)).strftime("%Y-%m-%d")
        hi = (base + timedelta(days=3)).strftime("%Y-%m-%d")
    req = urllib.request.Request(
        "https://brwalcuodwxsynrpiqjc.supabase.co/rest/v1/games"
        f"?select=id,home_team,away_team,start_date,tv&season=eq.2026"
        f"&start_date=gte.{lo}&start_date=lte.{hi}&order=start_date",
        headers={"apikey": ANON})
    games = jget_req(req)

    made = 0
    for g in games:
        gid = g["id"]
        d = jget(f"https://betbuddy-backend.onrender.com/canonical/games/"
                 f"{gid}/breakdown")
        picks = {p.get("market"): p for p in (d.get("picks") or [])
                 if p.get("pick_id") is not None}
        matchup = f"{g['away_team']} @ {g['home_team']}"
        kt = parse_ts(g["start_date"])
        kick = kt.strftime("%A, %B %-d · %I:%M %p ET").replace(" 0", " ") \
            if os.name != "nt" else \
            kt.strftime("%A, %B %d · %I:%M %p ET").replace(" 0", " ")
        if g.get("tv"):
            kick += f" · {g['tv']}"
        safe = matchup.lower().replace(" ", "-").replace("@", "at")
        out = os.path.join(outdir, f"w{week}-{safe}.png")
        if draw_card(gid, matchup, kick, picks, out):
            print("wrote", out)
            made += 1
        else:
            print("skipped (no picks at all):", matchup)
    print(f"{made} cards")


def jget_req(req):
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


if __name__ == "__main__":
    main()

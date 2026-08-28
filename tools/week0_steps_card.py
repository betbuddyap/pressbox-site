# -*- coding: utf-8 -*-
"""Week 0 step-timeline card — full journal granularity, every game.

    py -X utf8 tools/week0_steps_card.py [out.png]

The maximum-granularity sibling of week0_timeline_card.py: per game, a true
STEP CHART of the picked-side line from release to now (journal timestamps
to the second), segments colored by the grade held, a diamond where the pick
flipped sides, endpoint labels. Same public breakdown data.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime
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

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow   = font("seguisb.ttf", 17)
f_title     = font("georgiab.ttf", 60)
f_gloss     = font("segoeui.ttf", 16)
f_headright = font("seguisb.ttf", 15)
f_game      = font("georgiab.ttf", 21)
f_mkt       = font("seguisb.ttf", 13)
f_end       = font("seguisb.ttf", 15)
f_day       = font("seguisb.ttf", 13)
f_footurl   = font("georgiab.ttf", 26)
f_footnote  = font("seguisb.ttf", 14)

GAMES = [
    (401856766, "North Carolina @ TCU"),
    (401864494, "San José State @ USC"),
    (401858202, "NC State @ Virginia"),
    (401864577, "Jacksonville St @ North Dakota St"),
    (401866408, "Sacramento St @ E. Michigan"),
    (401864570, "New Mexico St @ Florida State"),
    (401858201, "Hawai'i @ Stanford"),
    (401862693, "Memphis @ UNLV"),
]


def fetch(gid):
    return json.load(urllib.request.urlopen(
        f"https://betbuddy-backend.onrender.com/canonical/games/{gid}/breakdown",
        timeout=60))


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(ET)


def pick_strip(d):
    picks = {p.get("market"): p for p in (d.get("picks") or [])
             if p.get("pick_id") is not None}
    order = ("spread", "total", "moneyline")
    for mk in order:
        p = picks.get(mk)
        if p and p.get("tier") not in (None, "no_edge"):
            return p
    for mk in order:
        p = picks.get(mk)
        h = (p or {}).get("history") or {}
        rel = (h.get("released") or {}).get("tier")
        trans = [t.get("tier") for t in h.get("transitions") or []]
        if p and any(t not in (None, "no_edge") for t in [rel] + trans):
            return p
    return picks.get("spread")


def num(v):
    try:
        return float(str(v).replace("+", ""))
    except (TypeError, ValueError):
        return None


def segments(p):
    """[(dt, side, line_float, line_str, tier)] carry-forward states."""
    h = p.get("history") or {}
    rel = h.get("released") or {}
    if not rel.get("at"):
        return []
    segs = [(parse_ts(rel["at"]), rel.get("side"), num(rel.get("line")),
             rel.get("line"), rel.get("tier"))]
    for t in h.get("transitions") or []:
        segs.append((parse_ts(t["observed_at"]), t.get("side"),
                     num(t.get("line")), t.get("line"), t.get("tier")))
    return segs


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "week0_steps.png"
    data = [(name, fetch(gid)) for gid, name in GAMES]
    strips = []
    t_min = t_max = None
    for name, d in data:
        p = pick_strip(d)
        segs = segments(p) if p else []
        strips.append((name, p, segs))
        if segs:
            t0 = segs[0][0]
            t_min = t0 if (t_min is None or t0 < t_min) else t_min
    now = datetime.now(ET)
    t_max = now
    span = (t_max - t_min).total_seconds()

    img = Image.new("RGB", (W, 4200 * S), INK)
    dr = ImageDraw.Draw(img)

    y = 44 * S
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    if os.path.exists(lp):
        lg = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        lg = lg.resize((int(lg.width * h_ / lg.height), h_), Image.LANCZOS)
        img.paste(lg, (PAD, y), lg)
    dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL · 2026",
            font=f_headright, fill=TEXT_LIGHT, anchor="rs")
    y += 96 * S + 22 * S

    dr.text((PAD, y), "EVERY MOVE, ON THE RECORD", font=f_eyebrow,
            fill=GOLD_LIGHT)
    y += 28 * S
    dr.text((PAD, y), "Week 0 · Release to Kickoff", font=f_title, fill=CREAM)
    y += 100 * S
    gloss = ("The picked side's number from the moment we released to now — "
             "every step is a real market move, the color is the grade we "
             "held, and a gold diamond marks a pick that changed sides. "
             "Timestamps to the second, straight from the journal.")
    words, line_, gy = gloss.split(), "", y
    for w_ in words:
        t_ = (line_ + " " + w_).strip()
        if dr.textlength(t_, font=f_gloss) <= W - 2 * PAD:
            line_ = t_
        else:
            dr.text((PAD, gy), line_, font=f_gloss, fill=TEXT_LIGHT)
            gy += 23 * S
            line_ = w_
    dr.text((PAD, gy), line_, font=f_gloss, fill=TEXT_LIGHT)
    y = gy + 34 * S
    dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
    y += 18 * S

    # shared time axis labels (day ticks)
    gx0, gx1 = PAD + 8 * S, W - PAD - 235 * S
    def X(dt):
        return gx0 + (gx1 - gx0) * ((dt - t_min).total_seconds() / span)
    day = datetime(t_min.year, t_min.month, t_min.day, tzinfo=ET)
    from datetime import timedelta
    ticks = []
    while day <= t_max:
        ticks.append(max(day, t_min) if day < t_min else day)
        day += timedelta(days=1)
    for tk in ticks:
        dr.text((X(tk), y + 14 * S), f"{tk.month}/{tk.day}", font=f_day,
                fill=TEXT_LIGHT, anchor="ms")
    dr.text((gx1 + 12 * S, y + 14 * S), "NOW", font=f_day, fill=GOLD_LIGHT,
            anchor="ls")
    y += 30 * S

    CH = 74 * S            # chart height per strip
    for name, p, segs in strips:
        dr.text((PAD, y + 16 * S), name, font=f_game, fill=CREAM, anchor="ls")
        if not segs:
            dr.text((W - PAD, y + 16 * S), "no board — ungraded matchup",
                    font=f_end, fill=TEXT_LIGHT, anchor="rs")
            y += 30 * S
            dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
            y += 14 * S
            continue
        mkt = {"spread": "SPREAD", "total": "TOTAL",
               "moneyline": "MONEYLINE"}.get(p.get("market"), "")
        tw = dr.textlength(name, font=f_game)
        dr.text((PAD + tw + 16 * S, y + 16 * S), mkt, font=f_mkt,
                fill=GOLD_LIGHT, anchor="ls")
        y += 26 * S

        vals = [v for _, _, v, _, _ in segs if v is not None]
        lo, hi = min(vals), max(vals)
        if hi - lo < 1e-9:
            lo -= 1.0
            hi += 1.0
        padv = (hi - lo) * 0.25
        lo, hi = lo - padv, hi + padv

        def Y(v):
            return y + CH - (CH * (v - lo) / (hi - lo))

        # day gridlines
        for tk in ticks:
            dr.line([X(tk), y, X(tk), y + CH], fill=DIVIDER, width=1)
        _labels = []
        _flips = []

        ext = segs + [(t_max, segs[-1][1], segs[-1][2], segs[-1][3],
                       segs[-1][4])]
        _cur_tier = None
        for i in range(len(segs)):
            t0_, side0, v0, _, tier0 = ext[i]
            t1_ = ext[i + 1][0]
            if v0 is None:
                continue
            # Color changes only when the NUMBER does (Austin, 2026-08-28:
            # "the line color change happens before the line moves. have it
            # change once it reaches the new line"): a grade change at an
            # unchanged number keeps the run's color; the new level wears
            # the grade in effect when it got there.
            if (i == 0 or ext[i - 1][2] is None
                    or v0 != ext[i - 1][2] or side0 != ext[i - 1][1]):
                _cur_tier = tier0
            col = TIER_COL.get(_cur_tier, DIM)
            if _cur_tier == "A+":
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
                    # side flip: dotted connector; diamond + label drawn in
                    # the two-pass step below (collision-safe)
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

        for cx, cy, _txt in _flips:
            r = 7 * S
            dr.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r),
                        (cx - r, cy)], fill=GOLD_LIGHT)
            _labels.append((cx - 11 * S, cy - 11 * S, cx + 11 * S,
                            cy + 11 * S))
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
        dr.text((gx0 - 6 * S, Y(rel[2]) + 5 * S) if rel[2] is not None else (gx0, y),
                f"{(rel[1] or '')[:1]} {rel[3]}", font=f_end, fill=TEXT_LIGHT,
                anchor="rs")
        end_txt = (f"{(last[1] or '')[:1]} {last[3]} · "
                   f"{TIER_LABEL.get(p.get('tier'), '')}")
        dr.text((gx1 + 12 * S, (Y(last[2]) + 5 * S) if last[2] is not None
                 else y + CH // 2), end_txt, font=f_end, fill=CREAM,
                anchor="ls")

        y += CH + 12 * S
        dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
        y += 14 * S

    # legend
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
        lx += 32 * S + int(dr.textlength(lbl, font=f_day)) + 28 * S
    _dw = dr.textlength("pick changed sides", font=f_day)
    _dx = W - PAD - _dw - 18 * S
    dr.polygon([(_dx, y + 4 * S), (_dx + 6 * S, y + 10 * S),
                (_dx, y + 16 * S), (_dx - 6 * S, y + 10 * S)],
               fill=GOLD_LIGHT)
    dr.text((W - PAD, y + 14 * S), "pick changed sides", font=f_day,
            fill=TEXT_LIGHT, anchor="rs")
    y += 34 * S

    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 26 * S
    dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
            fill=GOLD_LIGHT, anchor="ls")
    dr.text((W - PAD, fy + 22 * S), "EVERY NUMBER AS IT STOOD",
            font=f_footnote, fill=TEXT_LIGHT, anchor="rs")
    total_h = fy + 52 * S

    img.crop((0, 0, W, total_h)).save(out_path, "PNG")
    print(f"wrote {out_path} ({W}x{total_h})")


if __name__ == "__main__":
    main()

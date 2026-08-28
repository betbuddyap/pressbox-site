# -*- coding: utf-8 -*-
"""Week 0 timeline card — release -> now, day by day, every game.

    py -X utf8 tools/week0_timeline_card.py [out.png]

One strip per Week 0 game: each day-cell shows the day's DOMINANT state
(the line that held the most hours that day, time-weighted from the public
journal) with the grade as the tier-colored bar under it. Right side of
each strip: released -> now. Data: the public game-breakdown endpoint.
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
DIM = (74, 70, 60)

TIER_BAR = {"A+": GOLD_LIGHT, "A": GOLD, "B": SILVER, "C": BRONZE,
            "no_edge": DIM, None: DIM}

ET = ZoneInfo("America/New_York")

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow   = font("seguisb.ttf", 17)
f_title     = font("georgiab.ttf", 74)
f_gloss     = font("segoeui.ttf", 16)
f_headright = font("seguisb.ttf", 15)
f_game      = font("georgiab.ttf", 21)
f_mkt       = font("seguisb.ttf", 13)
f_cell      = font("seguisb.ttf", 14)
f_day       = font("seguisb.ttf", 13)
f_sum       = font("segoeui.ttf", 15)
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
TIER_LABEL = {"A+": "A+", "A": "A", "B": "B", "C": "C", "no_edge": "No Edge"}


def fetch(gid):
    return json.load(urllib.request.urlopen(
        f"https://betbuddy-backend.onrender.com/canonical/games/{gid}/breakdown",
        timeout=60))


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(ET)


def pick_strip(d):
    """The market whose story the strip tells: currently graded first
    (spread > total > ml), then ever-graded, then spread."""
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


def side_letter(side):
    return (side or "").strip()[:1].upper()


def segments(p):
    """[(start_dt, side, line, tier)] carry-forward states from the journal."""
    h = p.get("history") or {}
    rel = h.get("released") or {}
    if not rel.get("at"):
        return []
    segs = [(parse_ts(rel["at"]), rel.get("side"), rel.get("line"),
             rel.get("tier"))]
    for t in h.get("transitions") or []:
        segs.append((parse_ts(t["observed_at"]), t.get("side"),
                     t.get("line"), t.get("tier")))
    return segs


def dominant_by_day(segs, days):
    """day -> (side, line, tier) that held the most seconds that ET day."""
    out = {}
    if not segs:
        return out
    now = datetime.now(ET)
    for day in days:
        d0 = datetime(day.year, day.month, day.day, tzinfo=ET)
        d1 = min(d0 + timedelta(days=1), now)
        if d1 <= segs[0][0]:
            continue
        tally = {}
        for i, (ts, side, line, tier) in enumerate(segs):
            end = segs[i + 1][0] if i + 1 < len(segs) else now
            a, b = max(ts, d0), min(end, d1)
            if b > a:
                key = (side, line, tier)
                tally[key] = tally.get(key, 0.0) + (b - a).total_seconds()
        if tally:
            out[day] = max(tally.items(), key=lambda kv: kv[1])[0]
    return out


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "week0_timeline.png"
    data = [(name, fetch(gid)) for gid, name in GAMES]

    strips = []
    all_starts = []
    for name, d in data:
        p = pick_strip(d)
        segs = segments(p) if p else []
        strips.append((name, p, segs))
        if segs:
            all_starts.append(segs[0][0])
    start_day = min(all_starts).date()
    today = datetime.now(ET).date()
    days = []
    cur = start_day
    while cur <= today:
        days.append(cur)
        cur += timedelta(days=1)

    img = Image.new("RGB", (W, 3600 * S), INK)
    dr = ImageDraw.Draw(img)

    y = 44 * S
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    if os.path.exists(lp):
        lg = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        lg = lg.resize((int(lg.width * h_ / lg.height), h_), Image.LANCZOS)
        img.paste(lg, (PAD, y), lg)
    hr = "COLLEGE FOOTBALL · 2026"
    dr.text((W - PAD, y + 70 * S), hr, font=f_headright, fill=TEXT_LIGHT,
            anchor="rs")
    y += 96 * S + 22 * S

    dr.text((PAD, y), "THE GRADED BOARD, DAY BY DAY", font=f_eyebrow,
            fill=GOLD_LIGHT)
    y += 28 * S
    dr.text((PAD, y), "Week 0 · Release to Kickoff", font=f_title, fill=CREAM)
    y += 100 * S
    gloss = ("Every Week 0 game since the board released. Each cell is the "
             "day's number — the line that held the longest that day — and "
             "the bar under it is the grade we had. Every regrade is on the "
             "record.")
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
    y += 16 * S

    # Shared day axis
    n_days = len(days)
    grid_x0 = PAD
    grid_w = W - 2 * PAD
    cell_w = grid_w / n_days
    for i, day in enumerate(days):
        cx = grid_x0 + cell_w * (i + 0.5)
        lbl = f"{day.month}/{day.day}"
        dr.text((cx, y + 14 * S), lbl, font=f_day, fill=TEXT_LIGHT, anchor="ms")
    dr.text((grid_x0 + cell_w * (n_days - 0.5), y + 30 * S), "TODAY",
            font=f_day, fill=GOLD_LIGHT, anchor="ms")
    y += 40 * S

    for name, p, segs in strips:
        # Title row
        dr.text((PAD, y + 18 * S), name, font=f_game, fill=CREAM, anchor="ls")
        if p is None or not segs:
            dr.text((W - PAD, y + 18 * S), "no board — ungraded matchup",
                    font=f_sum, fill=TEXT_LIGHT, anchor="rs")
            y += 34 * S
            dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
            y += 16 * S
            continue
        mkt = {"spread": "SPREAD", "total": "TOTAL",
               "moneyline": "MONEYLINE"}.get(p.get("market"), "")
        tw = dr.textlength(name, font=f_game)
        dr.text((PAD + tw + 16 * S, y + 18 * S), mkt, font=f_mkt,
                fill=GOLD_LIGHT, anchor="ls")

        rel = (p.get("history") or {}).get("released") or {}
        now_side, now_line = p.get("side_display"), p.get("line")
        now_tier = p.get("tier")
        summary = (f"Released {TIER_LABEL.get(rel.get('tier'), '—')} · "
                   f"{side_letter(rel.get('side'))} {rel.get('line')}   →   "
                   f"Now {TIER_LABEL.get(now_tier, '—')} · "
                   f"{side_letter(now_side)} {now_line}")
        dr.text((W - PAD, y + 18 * S), summary, font=f_sum, fill=TEXT_LIGHT,
                anchor="rs")
        y += 30 * S

        dom = dominant_by_day(segs, days)
        for i, day in enumerate(days):
            x0 = grid_x0 + cell_w * i
            x1 = x0 + cell_w
            st = dom.get(day)
            cx = (x0 + x1) / 2
            if st is None:
                dr.text((cx, y + 22 * S), "—", font=f_cell, fill=DIM,
                        anchor="ms")
                bar = DIM
            else:
                side, line, tier = st
                txt = f"{side_letter(side)} {line}" if line is not None else "—"
                dr.text((cx, y + 22 * S), txt, font=f_cell, fill=CREAM,
                        anchor="ms")
                bar = TIER_BAR.get(tier, DIM)
            dr.rectangle([x0 + 3 * S, y + 30 * S, x1 - 3 * S, y + 34 * S],
                         fill=bar)
        y += 46 * S
        dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
        y += 16 * S

    # Legend
    y += 4 * S
    lx = PAD
    for tier in ("A+", "A", "B", "C", "no_edge"):
        dr.rectangle([lx, y + 6 * S, lx + 26 * S, y + 12 * S],
                     fill=TIER_BAR[tier])
        lbl = TIER_LABEL[tier]
        dr.text((lx + 32 * S, y + 14 * S), lbl, font=f_day, fill=TEXT_LIGHT,
                anchor="ls")
        lx += 32 * S + int(dr.textlength(lbl, font=f_day)) + 28 * S
    y += 34 * S

    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 26 * S
    dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
            fill=GOLD_LIGHT, anchor="ls")
    note = "EVERY NUMBER AS IT STOOD · GRADES ON THE RECORD"
    dr.text((W - PAD, fy + 22 * S), note, font=f_footnote, fill=TEXT_LIGHT,
            anchor="rs")
    total_h = fy + 52 * S

    img.crop((0, 0, W, total_h)).save(out_path, "PNG")
    print(f"wrote {out_path} ({W}x{total_h})")


if __name__ == "__main__":
    main()

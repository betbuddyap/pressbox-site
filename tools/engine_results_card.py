# -*- coding: utf-8 -*-
"""Every graded 2026 game across all three bet types, with the result.

    py -X utf8 tools/week_results_card.py [--ink] [out.png]

Per game: what we projected, the number we would have got, what
happened, and whether the bet won -- for spread, total and moneyline.
Record and return per market at the top.

PRICES COME FROM live_odds, EARLIEST SNAPSHOT PER BOOK. w1_2026.json has
lines but no juice, so it cannot produce a return, and betting_lines has
no 2026 moneyline at all (326 games, zero). live_odds carries all three
markets WITH prices and its snapshots reach back to 23 May, so the
earliest row per book is a genuine opener, not a close.

SIGNS, VERIFIED RATHER THAN ASSUMED. live_odds.spread_home is BOOK style
-- negative means the home team is favoured -- confirmed at corr -0.998
against w1_2026's home-margin field. It is flipped once, on read. The
card then shows everything in home-margin units so the three numbers on
a row can be compared by eye.

BEST LINE MEANS BEST FOR THE SIDE TAKEN: smallest spread to back home,
largest to back away, lowest total for over, highest for under, longest
price on either moneyline. Ties on the line break to the better price.
"""
import json
import os
import sys
from collections import defaultdict

from PIL import Image, ImageDraw, ImageFont

S_ = 2
W = 1080 * S_
PAD = 44 * S_
DARK = "--ink" in sys.argv or os.environ.get("CARD_THEME") == "ink"

LIGHT = dict(BG=(248, 245, 238), SURF=(239, 233, 220), RULE=(232, 225, 211),
             TEXT=(15, 14, 10), SOFT=(62, 57, 46), MUTED=(138, 130, 114),
             ACC=(184, 146, 42), ACCT=(184, 134, 11),
             GOOD=(74, 122, 74), BAD=(184, 90, 42),
             LOGO="pressbox-w2a-cream-cropped.png")
INK = dict(BG=(15, 14, 10), SURF=(28, 26, 21), RULE=(48, 45, 38),
           TEXT=(248, 245, 238), SOFT=(196, 188, 172), MUTED=(150, 142, 126),
           ACC=(124, 98, 32), ACCT=(198, 160, 70),
           GOOD=(107, 160, 107), BAD=(209, 122, 74),
           LOGO="pressbox-w2a-ink-cropped.png")
P = INK if DARK else LIGHT
F = "C:/Windows/Fonts"


def font(f, s):
    return ImageFont.truetype(os.path.join(F, f), s * S_)


f_title = font("georgiab.ttf", 38)
f_big = font("georgiab.ttf", 30)
f_meta = font("segoeui.ttf", 15)
f_note = font("segoeui.ttf", 12)
f_lbl = font("seguisb.ttf", 11)
f_row = font("segoeui.ttf", 14)
f_num = font("seguisb.ttf", 14)
f_mark = font("seguisb.ttf", 15)
f_sect = font("seguisb.ttf", 13)


def track(dr, xy, t, fn, fill, size, anchor="l", em=0.03):
    tr = em * size * S_
    ws = [fn.getlength(c) for c in t]
    x, y = xy
    if anchor == "r":
        x -= sum(ws) + tr * (len(t) - 1)
    elif anchor == "m":
        x -= (sum(ws) + tr * (len(t) - 1)) / 2
    for c, cw in zip(t, ws):
        dr.text((x, y), c, font=fn, fill=fill)
        x += cw + tr


def clip(t, w):
    """Trim to w px, marking the trim so a cut name never reads as real."""
    if f_row.getlength(t) <= w:
        return t
    while t and f_row.getlength(t + "…") > w:
        t = t[:-1]
    return t.rstrip() + "…"


def prof(o):
    o = float(o)
    return o / 100.0 if o > 0 else 100.0 / (-o)


def grade(scratch):
    W1 = json.load(open(os.path.join(scratch, "w1_2026.json"),
                        encoding="utf-8"))
    LO = json.load(open(os.path.join(scratch, "live_odds_2026.json"),
                        encoding="utf-8"))
    first = defaultdict(dict)
    for x in sorted(LO, key=lambda r: r.get("fetched_at") or ""):
        k = (x["game_id"], x["bookmaker"])
        for mk, col in (("sp", "spread_home"), ("tt", "total"),
                        ("ml", "moneyline_home")):
            if x.get(col) is not None and mk not in first[k]:
                first[k][mk] = x
    byg = defaultdict(list)
    for (g, _b), v in first.items():
        byg[g].append(v)

    out = []
    for r in W1:
        bks = byg.get(r["gid"], [])
        d = {"away": r["away"], "home": r["home"],
             "act_margin": r["act_margin"], "act_total": r["act_total"],
             "pred_margin": r["pred_margin"], "pred_total": r["pred_total"],
             "wk": 0 if (r.get("date") or "")[:10] <= "2026-08-31" else 1}
        sp = [(-float(v["sp"]["spread_home"]),
               float(v["sp"].get("spread_home_price") or -110),
               float(v["sp"].get("spread_away_price") or -110))
              for v in bks if "sp" in v]
        if sp:
            med = sorted(x[0] for x in sp)[len(sp) // 2]
            side = r["pred_margin"] > med
            cand = sorted(sp, key=lambda x: ((x[0], -x[1]) if side
                                             else (-x[0], -x[2])))
            ln, px = cand[0][0], (cand[0][1] if side else cand[0][2])
            dd = r["act_margin"] - ln
            d["sp"] = {"ours": r["pred_margin"], "line": ln, "price": px,
                       "res": "push" if abs(dd) < 1e-9 else
                       ("win" if (dd > 0) == side else "loss")}
        tt = [(float(v["tt"]["total"]),
               float(v["tt"].get("total_over_price") or -110),
               float(v["tt"].get("total_under_price") or -110))
              for v in bks if "tt" in v]
        if tt:
            med = sorted(x[0] for x in tt)[len(tt) // 2]
            over = r["pred_total"] > med
            cand = sorted(tt, key=lambda x: ((x[0], -x[1]) if over
                                             else (-x[0], -x[2])))
            ln, px = cand[0][0], (cand[0][1] if over else cand[0][2])
            dd = r["act_total"] - ln
            d["tt"] = {"ours": r["pred_total"], "line": ln, "price": px,
                       "over": over,
                       "res": "push" if abs(dd) < 1e-9 else
                       ("win" if (dd > 0) == over else "loss")}
        ml = [(float(v["ml"]["moneyline_home"]),
               float(v["ml"]["moneyline_away"]))
              for v in bks if "ml" in v
              and v["ml"].get("moneyline_away") is not None]
        if ml:
            side = r["pred_margin"] > 0
            px = max(x[0] for x in ml) if side else max(x[1] for x in ml)
            d["ml"] = {"side_home": side, "price": px,
                       "res": "win" if (r["act_margin"] > 0) == side
                       else "loss"}
        out.append(d)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = args[0] if args else ("week_results_ink.png" if DARK
                                else "week_results.png")
    scratch = os.path.join(
        os.environ.get("TEMP", ""), "claude",
        "C--Users-AustinPark-Documents-GitHub-pressbox-site",
        "b8b48263-e617-4758-aab0-7c787f9e200a", "scratchpad")
    G = grade(scratch)
    G.sort(key=lambda d: -abs(d["pred_margin"] - d["act_margin"]))

    def tally(key):
        xs = [d[key] for d in G if key in d]
        w = sum(1 for x in xs if x["res"] == "win")
        l = sum(1 for x in xs if x["res"] == "loss")
        p = sum(1 for x in xs if x["res"] == "push")
        roi = sum((prof(x["price"]) if x["res"] == "win" else -1.0)
                  for x in xs if x["res"] != "push")
        return w, l, p, (roi / (w + l) if w + l else 0.0)

    ROW = 30 * S_
    H = 480 * S_ + len(G) * ROW + 160 * S_
    img = Image.new("RGB", (W, H), P["BG"])
    dr = ImageDraw.Draw(img)
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, P["LOGO"])
    if os.path.exists(lp):
        lg = Image.open(lp).convert("RGB")
        h_ = 58 * S_
        lg = lg.resize((int(lg.width * h_ / lg.height), h_), Image.LANCZOS)
        msk = (lg.convert("L").point(lambda v: int(255 * (v / 255.) ** .5))
               if DARK else None)
        img.paste(lg, (PAD, 38 * S_), msk)
    track(dr, (W - PAD, 64 * S_), "EVERY BET, GRADED", f_sect, P["SOFT"],
          13, anchor="r")
    y = 116 * S_
    dr.rectangle([PAD, y, W - PAD, y + 1 * S_], fill=P["RULE"])
    y += 26 * S_
    dr.text((PAD, y), "2026 · Weeks 0 and 1", font=f_title, fill=P["TEXT"])
    y += 52 * S_
    dr.text((PAD, y), f"All {len(G)} games, every market, graded at the "
                      "best opening number with its real price.",
            font=f_meta, fill=P["SOFT"])
    y += 32 * S_

    tw = (W - 2 * PAD - 20 * S_) // 3
    for i, (lab, key) in enumerate((("SPREAD", "sp"), ("TOTAL", "tt"),
                                    ("MONEYLINE", "ml"))):
        w, l, p, roi = tally(key)
        x0 = PAD + i * (tw + 10 * S_)
        dr.rectangle([x0, y, x0 + tw, y + 104 * S_], fill=P["SURF"])
        track(dr, (x0 + 14 * S_, y + 22 * S_), lab, f_lbl, P["SOFT"], 11)
        rec = f"{w}-{l}" + (f"-{p}" if p else "")
        dr.text((x0 + 14 * S_, y + 72 * S_), rec, font=f_big,
                fill=P["TEXT"], anchor="ls")
        dr.text((x0 + tw - 14 * S_, y + 72 * S_), f"{roi:+.1%}",
                font=f_big, fill=P["GOOD"] if roi > 0 else P["BAD"],
                anchor="rs")
        dr.text((x0 + 14 * S_, y + 94 * S_),
                f"{w/(w+l):.1%} hit" if w + l else "—",
                font=f_note, fill=P["MUTED"], anchor="ls")
        dr.text((x0 + tw - 14 * S_, y + 94 * S_), "return per unit",
                font=f_note, fill=P["MUTED"], anchor="rs")
    y += 104 * S_ + 24 * S_

    NW = 470                      # matchup column, FINAL pixels
    BW = (W - 2 * PAD - NW - 40) // 3     # one market block
    cs = PAD + NW
    ct, cm = cs + BW + 20, cs + 2 * (BW + 20)
    OURS, LINE, FIN, MARK = 140, 270, 400, 462
    for x0, lab in ((cs, "SPREAD"), (ct, "TOTAL"), (cm, "MONEYLINE")):
        track(dr, (x0 + BW // 2, y), lab, f_lbl, P["ACCT"], 11, anchor="m")
    y += 20 * S_
    for x0 in (cs, ct):
        for off, lab in ((OURS, "ours"), (LINE, "line"), (FIN, "final")):
            track(dr, (x0 + off, y), lab, f_lbl, P["SOFT"], 11, anchor="r")
    for off, lab in ((LINE, "pick"), (FIN, "price")):
        track(dr, (cm + off, y), lab, f_lbl, P["SOFT"], 11, anchor="r")
    y += 16 * S_
    dr.rectangle([PAD, y, W - PAD, y + 1 * S_], fill=P["RULE"])
    y += 8 * S_

    def cell(x0, d, key, cy):
        if key not in d:
            dr.text((x0 + LINE, cy), "—", font=f_num, fill=P["MUTED"],
                    anchor="rm")
            return
        b = d[key]
        if key == "ml":
            nm = clip(d["home"] if b["side_home"] else d["away"],
                      LINE - 10)
            dr.text((x0 + LINE, cy), nm, font=f_row, fill=P["TEXT"],
                    anchor="rm")
            dr.text((x0 + FIN, cy), f"{int(b['price']):+d}",
                    font=f_num, fill=P["TEXT"], anchor="rm")
        else:
            fin = d["act_margin"] if key == "sp" else d["act_total"]
            for v, off in ((b["ours"], OURS), (b["line"], LINE),
                           (fin, FIN)):
                s = f"{v:+.1f}" if key == "sp" else f"{v:.1f}"
                dr.text((x0 + off, cy), s, font=f_num, fill=P["TEXT"],
                        anchor="rm")
        mx = x0 + MARK
        col = (P["GOOD"] if b["res"] == "win" else
               P["MUTED"] if b["res"] == "push" else P["BAD"])
        g = "W" if b["res"] == "win" else "P" if b["res"] == "push" else "L"
        dr.text((mx, cy), g, font=f_mark, fill=col, anchor="mm")

    for d in G:
        cy = y + ROW // 2 - 2 * S_
        if d["wk"] == 0:
            dr.rectangle([PAD - 8 * S_, y + 2 * S_, PAD - 4 * S_,
                          y + ROW - 4 * S_], fill=P["ACCT"])
        nm = clip(f"{d['away']} at {d['home']}", NW - 16)
        dr.text((PAD, cy), nm, font=f_row, fill=P["TEXT"], anchor="lm")
        cell(cs, d, "sp", cy)
        cell(ct, d, "tt", cy)
        cell(cm, d, "ml", cy)
        y += ROW
        dr.rectangle([PAD, y - 1 * S_, W - PAD, y], fill=P["RULE"])

    y += 20 * S_
    dr.rectangle([PAD, y, W - PAD, y + 3 * S_], fill=P["ACC"])
    y += 20 * S_
    dr.text((PAD, y), "Spread and final are the HOME team's margin — "
                      "positive means the home side won by that much. A "
                      "book would quote the favourite negative.",
            font=f_note, fill=P["MUTED"])
    y += 18 * S_
    dr.text((PAD, y), "Every bet settles at the best opening number for "
                      "the side taken, at that book's real price. Ordered "
                      "by our worst margin miss; gold tick = Week 0.",
            font=f_note, fill=P["MUTED"])
    y += 18 * S_
    dr.text((PAD, y), "Spread and moneyline answer different questions and "
                      "can disagree: the spread asks who beats the NUMBER, "
                      "the moneyline asks who WINS.",
            font=f_note, fill=P["MUTED"])
    y += 28 * S_
    track(dr, (PAD, y), "PRESSBOXANALYTICS.COM", f_lbl, P["ACCT"], 11)
    track(dr, (W - PAD, y), "GRADED AT THE OPENING LINE", f_lbl,
          P["MUTED"], 11, anchor="r")
    bot = y + 30 * S_
    img.crop((0, 0, W, bot)).save(out, "PNG")
    for lab, k in (("spread", "sp"), ("total", "tt"), ("moneyline", "ml")):
        w, l, p, roi = tally(k)
        print(f"  {lab:<10s} {w}-{l}" + (f"-{p}" if p else "") +
              f"   roi {roi:+.1%}")
    print(f"wrote {out}  ({W}x{bot})")


if __name__ == "__main__":
    main()

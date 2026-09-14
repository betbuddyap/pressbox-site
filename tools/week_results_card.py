# -*- coding: utf-8 -*-
"""Weekly W/L card — every graded pick, settled, in the board card's
visual language (ink, serif title, ll-badges, gold rule, footer).
PAGINATED like week_board_card.py: ~4100px cap per card, full header on
card 1, slim continuation header after, footer on every card.

    py -X utf8 tools/week_results_card.py [out.png] [week]

Data: the public results feed (released tiers, results, prices, and the
full-week sheet). Units are the SITE'S exact math: the allocator's
weights scaled so the week's sheet averages one unit per graded pick —
what the Results page hero prints. Sage check = win, rust cross = loss,
dim dash = push. No-edge verdicts never touch the record.
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
DIM = (74, 70, 60)
SAGE = (107, 160, 107)          # --sage-light: wins on ink need the light cut
RUST = (209, 122, 74)           # --rust-light
ET = ZoneInfo("America/New_York")
MKT = {"spread": "SPREAD", "total": "TOTAL", "ml": "ML"}

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow  = font("seguisb.ttf", 17)
f_title    = font("georgiab.ttf", 64)
f_stat     = font("georgiab.ttf", 40)
f_statlab  = font("seguisb.ttf", 13)
f_gloss    = font("segoeui.ttf", 16)
f_row      = font("seguisb.ttf", 18)
f_rowsub   = font("segoeui.ttf", 14)
f_badge    = font("seguisb.ttf", 14)
f_mkt      = font("seguisb.ttf", 12)
f_sect     = font("seguisb.ttf", 15)
f_glyph    = font("seguisym.ttf", 20)
f_footurl  = font("georgiab.ttf", 26)
f_footnote = font("seguisb.ttf", 13)

API = "https://betbuddy-backend.onrender.com"
GAMMA = 0.5


def am_to_dec(a):
    try:
        a = float(str(a).replace("\u2212", "-").replace("+", ""))
    except (TypeError, ValueError):
        return None
    if not a:
        return None
    return 1 + a / 100 if a > 0 else 1 + 100 / (-a)


def delta_weight(p, dec):
    if not p or not dec or dec <= 1:
        return 0.0
    edge = p - 1 / dec
    return (edge * p) ** GAMMA if edge > 0 else 0.0


def fetch(week):
    req = urllib.request.Request(f"{API}/canonical/results/feed?season=2026")
    d = json.load(urllib.request.urlopen(req, timeout=90))
    # Weekly sheet totals — every released graded pick, settled or not,
    # exactly the Results page's denominators.
    tot = n = 0.0
    for s in d.get("sheet") or []:
        if s.get("week") != week:
            continue
        tot += delta_weight(s.get("our_prob"), am_to_dec(s.get("price_raw")))
        n += 1
    rows = []
    for g in d.get("games") or []:
        if g.get("week") != week:
            continue
        for p in g.get("picks") or []:
            if not p.get("tier") or p["tier"] == "no_edge":
                continue
            dec = am_to_dec(p.get("price_raw"))
            wgt = delta_weight(p.get("our_prob"), dec)
            stake = (n * wgt / tot) if tot > 0 else 0.0
            pnl = (0.0 if not stake else
                   stake * (dec - 1) if p["result"] == "win" else
                   -stake if p["result"] == "loss" else 0.0)
            rows.append(dict(
                matchup=g.get("matchup"), kick=g.get("kickoff"),
                market=p.get("market"), tier=p.get("tier"),
                side=p.get("side"), line=p.get("line"),
                price=p.get("price"), book=(p.get("book") or {}).get("name"),
                result=p.get("result"), stake=stake, pnl=pnl))
    rows.sort(key=lambda r: (r["kick"] or "", r["matchup"] or "", r["market"]))
    return rows


def badge(dr, x, base, tier):
    w, h, rad = 36 * S, 32 * S, 2 * S
    top = base - 23 * S
    lbl = {"A+": "A+", "A": "A", "B": "B", "C": "C"}.get(tier, "NE")
    if tier == "A+":
        dr.rounded_rectangle([x, top, x + w, top + h], radius=rad,
                             fill=INK, outline=GOLD, width=2 * S)
        txt = GOLD_LIGHT
    elif tier == "A":
        dr.rounded_rectangle([x, top, x + w, top + h], radius=rad, fill=GOLD)
        txt = CREAM
    elif tier == "B":
        dr.rounded_rectangle([x, top, x + w, top + h], radius=rad, fill=SILVER)
        txt = INK
    elif tier == "C":
        dr.rounded_rectangle([x, top, x + w, top + h], radius=rad, fill=BRONZE)
        txt = CREAM
    else:
        dr.rounded_rectangle([x, top, x + w, top + h], radius=rad,
                             outline=DIM, width=1 * S)
        txt = TEXT_LIGHT
    dr.text((x + w / 2, top + h / 2 + 1 * S), lbl, font=f_badge,
            fill=txt, anchor="mm")
    return w


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "week1_results.png"
    week = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    rows = fetch(week)
    wins = [r for r in rows if r["result"] == "win"]
    losses = [r for r in rows if r["result"] == "loss"]
    pushes = [r for r in rows if r["result"] == "push"]
    net = sum(r["pnl"] for r in rows)
    staked = sum(r["stake"] for r in rows)
    roi = (net / staked * 100) if staked else 0.0


    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    logo = None
    if os.path.exists(lp):
        logo = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        logo = logo.resize((int(logo.width * h_ / logo.height), h_),
                           Image.LANCZOS)

    def wrap(text, fn, width):
        m = ImageDraw.Draw(Image.new("RGB", (1, 1)))
        out_, line_ = [], ""
        for w_ in text.split():
            t_ = (line_ + " " + w_).strip()
            if m.textlength(t_, font=fn) <= width:
                line_ = t_
            else:
                out_.append(line_)
                line_ = w_
        if line_:
            out_.append(line_)
        return out_

    # Stat strip — the Results hero's numbers, serif display values.
    stats = [
        (f"{len(wins)}–{len(losses)}" + (f"–{len(pushes)}" if pushes else ""),
         "RECORD", CREAM),
        (f"{'+' if net >= 0 else '−'}{abs(net):.1f}u", "NET UNITS",
         SAGE if net >= 0 else RUST),
        (f"{'+' if net >= 0 else '−'}{abs(roi):.1f}%", "ROI",
         SAGE if net >= 0 else RUST),
        (f"{staked:.0f}u", "STAKED", CREAM),
    ]
    gloss = ("Every graded pick, settled at the released number and price. "
             "Units are the allocator's own weights, scaled so the week's "
             "sheet averages one unit per pick — a strong pick carries more "
             "than a unit, a thin one less. No-edge verdicts never touch "
             "the record.")
    gloss_lines = wrap(gloss, f_gloss, W - 2 * PAD)

    # Header heights: logo block 44+96+22, eyebrow 30, title 96, stats 88,
    # gloss lines, gap 32, rule 4, gap 24.
    HEAD_FULL = (44 + 96 + 22 + 30 + 96 + 88 + len(gloss_lines) * 23
                 + 32 + 4 + 24) * S
    HEAD_SLIM = (44 + 96 + 22 + 30 + 4 + 24) * S
    FOOT = (12 + 4 + 26 + 52) * S
    CAP = 2050 * S          # ~4100px per card (Austin 9/7: not so tall)

    # ---- measured item list: sections + rows ----
    items = []
    for lbl, group in ((f"WINS ({len(wins)})", wins),
                       (f"LOSSES ({len(losses)})", losses),
                       (f"PUSHES ({len(pushes)})", pushes)):
        if not group:
            continue
        items.append(dict(kind="sect", lbl=lbl, h=26 * S))
        for r in group:
            items.append(dict(kind="row", r=r, h=68 * S))
        items.append(dict(kind="gap", h=16 * S))

    # ---- paginate: never break right after a section label ----
    pages, cur, sect_lbl = [], [], None
    rem = CAP - HEAD_FULL - FOOT
    i = 0
    while i < len(items):
        it = items[i]
        need = it["h"]
        if it["kind"] == "sect" and i + 1 < len(items):
            need += items[i + 1]["h"]
        if need > rem and cur:
            pages.append(cur)
            cur = []
            rem = CAP - HEAD_SLIM - FOOT
            if sect_lbl and it["kind"] == "row":
                cont = dict(kind="sect", lbl=f"{sect_lbl} · CONT.", h=26 * S)
                cur.append(cont)
                rem -= cont["h"]
        if it["kind"] == "sect":
            sect_lbl = it["lbl"]
        cur.append(it)
        rem -= it["h"]
        i += 1
    if cur:
        pages.append(cur)
    N = len(pages)

    def day_lbl(k):
        d = datetime.fromisoformat(str(k).replace("Z", "+00:00")).astimezone(ET)
        return d.strftime("%a %#m/%#d") if os.name == "nt" else d.strftime("%a %-m/%-d")

    def draw_row(dr, r, y):
        base = y + 26 * S
        line = r.get("line") or ""
        bet = f"{r.get('side') or ''} {line}".strip()
        px = f" ({r['price']})" if r.get("price") else ""
        dr.text((PAD, base), bet + px, font=f_row, fill=CREAM, anchor="ls")
        bw = dr.textlength(bet + px, font=f_row)
        dr.text((PAD + bw + 12 * S, base), MKT.get(r["market"], ""),
                font=f_mkt, fill=GOLD_LIGHT, anchor="ls")
        sub = f"{r['matchup']} · {day_lbl(r['kick'])}"
        if r.get("book"):
            sub += f" · {r['book']}"
        dr.text((PAD, base + 20 * S), sub, font=f_rowsub,
                fill=TEXT_LIGHT, anchor="ls")
        # Right side: units result, then the glyph, then the badge.
        pnl = r["pnl"]
        # A sub-0.05u stake rounds to "+0.0u", which reads broken on a
        # public card — give tiny results a second decimal instead.
        _d = 1 if abs(pnl) >= 0.05 or pnl == 0 else 2
        pnl_txt = ("push" if r["result"] == "push"
                   else f"{'+' if pnl >= 0 else '−'}{abs(pnl):.{_d}f}u")
        pnl_col = (DIM if r["result"] == "push"
                   else SAGE if pnl >= 0 else RUST)
        dr.text((W - PAD, base), pnl_txt, font=f_row, fill=pnl_col,
                anchor="rs")
        glyph, gcol = (("✓", SAGE) if r["result"] == "win"
                       else ("✕", RUST) if r["result"] == "loss"
                       else ("–", DIM))
        dr.text((W - PAD - 120 * S, base), glyph, font=f_glyph,
                fill=gcol, anchor="rs")
        badge(dr, W - PAD - 220 * S, base, r["tier"])
        y += 62 * S
        dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
        return y + 6 * S

    # ---- render pages ----
    stem = out[:-4] if out.lower().endswith(".png") else out
    outs = []
    for pi, page in enumerate(pages, 1):
        content_h = sum(it["h"] for it in page)
        head = HEAD_FULL if pi == 1 else HEAD_SLIM
        img = Image.new("RGB", (W, head + content_h + FOOT + 60 * S), INK)
        dr = ImageDraw.Draw(img)
        y = 44 * S
        if logo is not None:
            img.paste(logo, (PAD, y), logo)
        dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL · 2026",
                font=f_sect, fill=TEXT_LIGHT, anchor="rs")
        y += 96 * S + 22 * S
        eyebrow = f"WEEK {week} · EVERY PICK, GRADED"
        if N > 1:
            eyebrow += f" · {pi} OF {N}"
        dr.text((PAD, y), eyebrow, font=f_eyebrow, fill=GOLD_LIGHT)
        y += 30 * S
        if pi == 1:
            dr.text((PAD, y), f"Week {week}, graded.", font=f_title,
                    fill=CREAM)
            y += 96 * S
            sx = PAD
            for val, lab, col in stats:
                dr.text((sx, y), val, font=f_stat, fill=col)
                dr.text((sx, y + 52 * S), lab, font=f_statlab,
                        fill=TEXT_LIGHT)
                sx += max(dr.textlength(val, font=f_stat),
                          dr.textlength(lab, font=f_statlab)) + 56 * S
            y += 88 * S
            for ln in gloss_lines:
                dr.text((PAD, y), ln, font=f_gloss, fill=TEXT_LIGHT)
                y += 23 * S
            y += 32 * S
        dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
        y += 24 * S

        for it in page:
            if it["kind"] == "sect":
                dr.text((PAD, y + 12 * S), it["lbl"], font=f_sect,
                        fill=GOLD_LIGHT, anchor="ls")
                y += it["h"]
            elif it["kind"] == "gap":
                y += it["h"]
            else:
                y = draw_row(dr, it["r"], y)

        y += 12 * S
        dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
        fy = y + 26 * S
        dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
                fill=GOLD_LIGHT, anchor="ls")
        dr.text((W - PAD, fy + 22 * S),
                "GRADED ON THE RELEASED LINE · EVERY PICK ON THE RECORD",
                font=f_footnote, fill=TEXT_LIGHT, anchor="rs")
        name = out if N == 1 else f"{stem}_{pi}of{N}.png"
        img.crop((0, 0, W, fy + 52 * S)).save(name, "PNG")
        outs.append(name)
    print(f"wrote {' + '.join(outs)} | {len(wins)}-{len(losses)}"
          + (f"-{len(pushes)}" if pushes else "")
          + f" | net {net:+.1f}u on {staked:.0f}u | rows {len(rows)} | pages {N}")


if __name__ == "__main__":
    main()

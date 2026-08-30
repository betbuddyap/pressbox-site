# -*- coding: utf-8 -*-
"""Week 0 settled card — released record + allocator sizing, with/without parlays.

    py -X utf8 tools/week0_allocator_card.py [out.png]

Recreates the Week 0 allocator sheet exactly as the site computes it
(Moderate preset beta=0.5, SIZING_GAMMA=0.50, $1,000 pot, parlay tickets =
the presets the allocator pulls: Best 3-leg then next distinct type), on the
RELEASED picks at RELEASED prices — the numbers grading settles against.
Sizing probabilities are the same ones the product used: the released
bloc's weighted hit rate for spread/total, the blend's win probability for
ML. Inputs embedded below (pulled from the public game breakdowns,
2026-08-30); the math runs fresh each render.
"""
import os
import sys

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
RUST = (186, 92, 48)
DIM = (74, 70, 60)
TIER_COL = {"A+": GOLD_LIGHT, "A": GOLD, "B": SILVER, "C": BRONZE}

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow  = font("seguisb.ttf", 17)
f_title    = font("georgiab.ttf", 64)
f_gloss    = font("segoeui.ttf", 16)
f_head     = font("seguisb.ttf", 13)
f_row      = font("seguisb.ttf", 17)
f_rowsub   = font("segoeui.ttf", 14)
f_num      = font("seguisb.ttf", 17)
f_tile_k   = font("seguisb.ttf", 14)
f_tile_v   = font("georgiab.ttf", 40)
f_tile_s   = font("segoeui.ttf", 14)
f_sect     = font("seguisb.ttf", 15)
f_footurl  = font("georgiab.ttf", 26)
f_footnote = font("seguisb.ttf", 13)

# ── Inputs: released picks at released prices, sized on the product's own
#    probabilities; won = graded against the released number ─────────────
def am_to_dec(a):
    return 1 + a / 100 if a > 0 else 1 + 100 / (-a)

LEGS = [
    # key, matchup, bet, tier, p_sizing, american, won
    ("sjsu",  "San José State @ USC",           "San José State +38.5", "C", 0.7037,   -110, True),
    ("uvau",  "NC State @ Virginia",            "Under 53.5",           "B", 0.5839,   -110, True),
    ("fsusp", "New Mexico State @ Florida St.", "Florida State −30.5",  "C", 0.5754,   -115, False),
    ("fsuu",  "New Mexico State @ Florida St.", "Under 53.5",           "C", 0.5934,   -105, True),
    ("hawml", "Hawai'i @ Stanford",             "Hawai'i ML",           "C", 0.52005,   190, False),
    ("memsp", "Memphis @ UNLV",                 "Memphis +6.5",         "C", 0.6231,   -115, True),
    ("memml", "Memphis @ UNLV",                 "Memphis ML",           "C", 0.487525,  195, True),
]
GAME = {"sjsu": "usc", "uvau": "uva", "fsusp": "fsu", "fsuu": "fsu",
        "hawml": "stan", "memsp": "unlv", "memml": "unlv"}
GAMMA, BETA, POT = 0.50, 0.5, 1000.0

L = [dict(key=k, matchup=m, bet=b, tier=t, p=p, am=am, dec=am_to_dec(am), won=w)
     for (k, m, b, t, p, am, w) in LEGS]

def delta_w(p, dec):
    edge = p - 1 / dec
    return 0.0 if edge <= 0 else (edge * p) ** GAMMA

def pick3(ranked):
    out, used = [], set()
    for l in ranked:
        g = GAME[l["key"]]
        if g in used:
            continue
        used.add(g)
        out.append(l)
        if len(out) == 3:
            break
    return out

best3   = pick3(sorted(L, key=lambda l: -(l["p"] * l["dec"])))
long3   = pick3(sorted(L, key=lambda l: -(l["p"] * l["dec"] ** 2)))
safe3   = pick3(sorted(L, key=lambda l: -l["p"]))
sig = lambda t: tuple(sorted(x["key"] for x in t))

TICKETS, seen, types = [], set(), set()
for name, t in (("Best 3-leg", best3), ("Longshot 3-leg", long3), ("Safest 3-leg", safe3)):
    s, ty = sig(t), name.split()[0]
    if s in seen or ty in types:
        continue
    seen.add(s); types.add(ty)
    p = dec = 1.0
    for x in t:
        p *= x["p"]; dec *= x["dec"]
    TICKETS.append(dict(name=name, legs=t, p=p, dec=dec,
                        won=all(x["won"] for x in t)))
    if len(TICKETS) == 2:
        break

def sheet(include_parlays):
    cand = []
    for l in L:
        f = delta_w(l["p"], l["dec"])
        if f > 0:
            cand.append(dict(item=l, w=f * l["dec"] ** BETA, dec=l["dec"],
                             won=l["won"], is_p=False))
    if include_parlays:
        for t in TICKETS:
            f = delta_w(t["p"], t["dec"]) * t["p"]
            if f > 0:
                cand.append(dict(item=t, w=f * t["dec"] ** BETA, dec=t["dec"],
                                 won=t["won"], is_p=True))
    tot = sum(c["w"] for c in cand)
    for c in cand:
        c["stake"] = POT * c["w"] / tot
        c["pnl"] = c["stake"] * (c["dec"] - 1) if c["won"] else -c["stake"]
    return cand

rows_no = sheet(False)
rows_yes = sheet(True)
net_no = sum(c["pnl"] for c in rows_no)
net_yes = sum(c["pnl"] for c in rows_yes)
wins = sum(1 for l in L if l["won"])
losses = len(L) - wins
flat_pnl = sum((l["dec"] - 1) if l["won"] else -1 for l in L)

def fmt_am(am):
    return f"+{am}" if am > 0 else str(am)


def draw_result(dr, cx, cy, won):
    """Hand-drawn check / cross — Segoe renders ✓/✕ as tofu at these sizes
    (same lesson as the timeline cards' diamonds: draw glyphs, don't trust
    the font)."""
    r = 8 * S
    if won:
        dr.line([cx - r, cy, cx - r // 3, cy + r - 2 * S],
                fill=GOLD_LIGHT, width=3 * S)
        dr.line([cx - r // 3, cy + r - 2 * S, cx + r, cy - r + 2 * S],
                fill=GOLD_LIGHT, width=3 * S)
    else:
        dr.line([cx - r + 2 * S, cy - r + 2 * S, cx + r - 2 * S, cy + r - 2 * S],
                fill=RUST, width=3 * S)
        dr.line([cx - r + 2 * S, cy + r - 2 * S, cx + r - 2 * S, cy - r + 2 * S],
                fill=RUST, width=3 * S)

def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "week0_allocator.png"
    img = Image.new("RGB", (W, 3000 * S), INK)
    dr = ImageDraw.Draw(img)

    y = 44 * S
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    if os.path.exists(lp):
        lg = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        lg = lg.resize((int(lg.width * h_ / lg.height), h_), Image.LANCZOS)
        img.paste(lg, (PAD, y), lg)
    dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL · 2026", font=f_head,
            fill=TEXT_LIGHT, anchor="rs")
    y += 96 * S + 22 * S

    dr.text((PAD, y), "WEEK 0 · SETTLED · EVERY RELEASED PICK", font=f_eyebrow,
            fill=GOLD_LIGHT)
    y += 30 * S
    dr.text((PAD, y), f"The Board Went {wins}–{losses}.", font=f_title, fill=CREAM)
    y += 88 * S
    gloss = ("Every pick below released before kickoff and is graded on the "
             "released line — never the close. Stakes are the site's own "
             "allocator splitting a $1,000 pot (Moderate), exactly as the "
             "page sized it.")
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
    y += 26 * S

    # ── Straights table ──────────────────────────────────────────────
    dr.text((PAD, y + 12 * S), "THE PICKS", font=f_sect, fill=GOLD_LIGHT,
            anchor="ls")
    y += 24 * S
    # columns: badge+bet | price | stake | result | p&l
    col_px = W - PAD - 300 * S    # price right edge
    col_st = W - PAD - 190 * S    # stake right edge
    col_rs = W - PAD - 120 * S    # glyph center
    col_pl = W - PAD              # pnl right edge
    dr.text((PAD, y + 14 * S), "BET · AS RELEASED", font=f_head, fill=TEXT_LIGHT, anchor="ls")
    dr.text((col_px, y + 14 * S), "PRICE", font=f_head, fill=TEXT_LIGHT, anchor="rs")
    dr.text((col_st, y + 14 * S), "STAKE", font=f_head, fill=TEXT_LIGHT, anchor="rs")
    dr.text((col_pl, y + 14 * S), "NET", font=f_head, fill=TEXT_LIGHT, anchor="rs")
    y += 24 * S
    dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
    y += 6 * S

    by_key = {c["item"]["key"]: c for c in rows_yes if not c["is_p"]}
    for c in sorted([c for c in rows_yes if not c["is_p"]],
                    key=lambda x: -x["stake"]):
        l = c["item"]
        base = y + 26 * S
        sq = 12 * S
        dr.rectangle([PAD, base - sq, PAD + sq, base], fill=TIER_COL[l["tier"]])
        dr.text((PAD + sq + 10 * S, base), l["bet"], font=f_row, fill=CREAM,
                anchor="ls")
        bw = dr.textlength(l["bet"], font=f_row)
        dr.text((PAD + sq + 10 * S + bw + 12 * S, base), l["tier"],
                font=f_head, fill=TIER_COL[l["tier"]], anchor="ls")
        dr.text((PAD + sq + 10 * S, base + 19 * S), l["matchup"],
                font=f_rowsub, fill=TEXT_LIGHT, anchor="ls")
        dr.text((col_px, base), fmt_am(l["am"]), font=f_num, fill=CREAM, anchor="rs")
        dr.text((col_st, base), f"${c['stake']:.0f}", font=f_num, fill=CREAM, anchor="rs")
        draw_result(dr, col_rs, base - 8 * S, c["won"])
        pcol = GOLD_LIGHT if c["pnl"] > 0 else RUST
        dr.text((col_pl, base), f"{c['pnl']:+.0f}", font=f_num, fill=pcol, anchor="rs")
        y += 56 * S
        dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
        y += 4 * S

    # ── Parlays ──────────────────────────────────────────────────────
    y += 18 * S
    dr.text((PAD, y + 12 * S), "THE PARLAYS ON THE SHEET", font=f_sect,
            fill=GOLD_LIGHT, anchor="ls")
    y += 32 * S
    for c in [c for c in rows_yes if c["is_p"]]:
        t = c["item"]
        base = y + 26 * S
        dr.text((PAD, base), t["name"], font=f_row, fill=CREAM, anchor="ls")
        nw = dr.textlength(t["name"], font=f_row)
        dr.text((PAD + nw + 12 * S, base), f"+{(t['dec']-1)*100:.0f}",
                font=f_num, fill=GOLD, anchor="ls")
        legs_txt = "  ·  ".join(x["bet"] for x in t["legs"])
        dr.text((PAD, base + 20 * S), legs_txt, font=f_rowsub, fill=TEXT_LIGHT,
                anchor="ls")
        dr.text((col_st, base), f"${c['stake']:.0f}", font=f_num, fill=CREAM,
                anchor="rs")
        draw_result(dr, col_rs, base - 8 * S, c["won"])
        pcol = GOLD_LIGHT if c["pnl"] > 0 else RUST
        dr.text((col_pl, base), f"{c['pnl']:+.0f}", font=f_num, fill=pcol,
                anchor="rs")
        y += 58 * S
        dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
        y += 4 * S

    # ── Summary tiles ────────────────────────────────────────────────
    y += 26 * S
    tiles = [
        ("FLAT · ONE UNIT EACH", f"{wins}–{losses}",
         f"{flat_pnl:+.2f}u on {len(L)}u · {flat_pnl/len(L)*100:+.1f}%"),
        ("ALLOCATOR · STRAIGHTS", f"${1000+net_no:,.0f}",
         f"$1,000 in · {net_no/10:+.1f}%"),
        ("ALLOCATOR · WITH PARLAYS", f"${1000+net_yes:,.0f}",
         f"$1,000 in · {net_yes/10:+.1f}%"),
    ]
    tw = (W - 2 * PAD - 2 * 24 * S) / 3
    tx = PAD
    for k, v, s_ in tiles:
        dr.rounded_rectangle([tx, y, tx + tw, y + 128 * S], radius=10 * S,
                             outline=DIVIDER, width=2 * S)
        cx = tx + tw / 2
        dr.text((cx, y + 30 * S), k, font=f_tile_k, fill=TEXT_LIGHT, anchor="ms")
        dr.text((cx, y + 82 * S), v, font=f_tile_v, fill=GOLD_LIGHT, anchor="ms")
        dr.text((cx, y + 108 * S), s_, font=f_tile_s, fill=TEXT_LIGHT, anchor="ms")
        tx += tw + 24 * S
    y += 128 * S + 30 * S

    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 26 * S
    dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
            fill=GOLD_LIGHT, anchor="ls")
    note = "GRADED ON THE RELEASED LINE · ONE WEEK · NOT A PROMISE"
    dr.text((W - PAD, fy + 22 * S), note, font=f_footnote, fill=TEXT_LIGHT,
            anchor="rs")
    total_h = fy + 52 * S

    img.crop((0, 0, W, total_h)).save(out_path, "PNG")
    print(f"wrote {out_path} ({W}x{total_h})")
    print(f"no-parlay net {net_no:+.2f} | with-parlay net {net_yes:+.2f} | flat {wins}-{losses} {flat_pnl:+.2f}u")


if __name__ == "__main__":
    main()

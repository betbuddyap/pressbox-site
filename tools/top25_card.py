# -*- coding: utf-8 -*-
"""Render the Top 25 card as a downloadable PNG, straight from the live board.

    py -X utf8 tools/top25_card.py [out.png]

Mirrors top25.html's dark card at 2x resolution (2160px wide). Fonts are the
token stack's own fallbacks (Georgia bold for --serif, Segoe UI for --sans),
so no font downloads are needed. Rerun any week for a fresh card.
"""
import json
import os
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFont

S = 2               # 2x scale for crispness
W = 1080 * S
PAD = 64 * S

INK = (15, 14, 10)
CREAM = (248, 245, 238)
GOLD = (184, 146, 42)
GOLD_LIGHT = (231, 190, 77)
TEXT_LIGHT = (163, 154, 136)
SAGE_LIGHT = (107, 160, 107)
RUST_LIGHT = (209, 122, 74)
DIVIDER = (45, 44, 40)      # cream at 13% over ink

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow   = font("seguisb.ttf", 17)
f_title     = font("georgiab.ttf", 84)
f_term      = font("seguisb.ttf", 15)
f_gloss     = font("segoeui.ttf", 16)
f_headright = font("seguisb.ttf", 15)
f_movekey   = font("segoeui.ttf", 15)
f_rank      = font("georgiab.ttf", 27)
f_team      = font("georgiab.ttf", 24)
f_rating    = font("segoeui.ttf", 17)
f_move      = font("seguisb.ttf", 16)
f_footurl   = font("georgiab.ttf", 26)
f_footnote  = font("seguisb.ttf", 14)

FORM = [
    ("WHAT YOU PROVED",
     "Last season's rating, carried at about half strength — history says "
     "nobody stays exactly who they were."),
    ("PRODUCTION ON YOUR ROSTER",
     "What your players actually did last year — offense and defense, wherever "
     "they played. Transfers bring it with them."),
    ("TALENT HELD",
     "The recruiting classes already on campus, stacked over the last three years."),
    ("TALENT ACQUIRED",
     "The class you just signed."),
]


def wrap(draw, text, fnt, width):
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if draw.textlength(t, font=fnt) <= width:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def ellipsize(draw, text, fnt, width):
    if draw.textlength(text, font=fnt) <= width:
        return text
    while text and draw.textlength(text + "…", font=fnt) > width:
        text = text[:-1]
    return text + "…"


def pick_logo():
    """The brighter mark reads on ink."""
    best, best_lum = None, -1.0
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for name in ("pressbox-w2a-ink-cropped.png", "pressbox-w2a-cream-cropped.png"):
        p = os.path.join(here, name)
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGBA")
        px = im.getdata()
        vals = [(r + g + b) / 3 for r, g, b, a in px if a > 40]
        lum = sum(vals) / len(vals) if vals else 0
        if lum > best_lum:
            best, best_lum = im, lum
    return best


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "top25.png"
    d = json.load(urllib.request.urlopen(
        "https://betbuddy-backend.onrender.com/rankings/teams?season=2026&offseason=1",
        timeout=120))
    rows = sorted(d.get("teams") or [], key=lambda r: -(r.get("rating") or -99))[:25]
    if len(rows) < 25:
        sys.exit(f"board returned {len(rows)} teams")

    img = Image.new("RGB", (W, 3200 * S), INK)
    dr = ImageDraw.Draw(img)

    # ── Header: logo + right caps ──
    y = 48 * S
    logo = pick_logo()
    logo_h = 104 * S
    if logo:
        ratio = logo_h / logo.height
        lg = logo.resize((int(logo.width * ratio), logo_h), Image.LANCZOS)
        img.paste(lg, (PAD, y), lg)
    hr = "COLLEGE FOOTBALL · 2026"
    dr.text((W - PAD - dr.textlength(hr, font=f_headright), y + logo_h - 30 * S),
            hr, font=f_headright, fill=TEXT_LIGHT)
    y += logo_h + 26 * S

    # ── Title block ──
    dr.text((PAD, y), "PRESSBOX POWER RATINGS", font=f_eyebrow, fill=GOLD_LIGHT)
    y += 30 * S
    dr.text((PAD, y), "Preseason Top 25", font=f_title, fill=CREAM)
    y += 112 * S

    # ── Formula 2x2 ──
    col_w = (W - 2 * PAD - 44 * S) // 2
    xs = [PAD, PAD + col_w + 44 * S]
    row_y = y
    for i in range(0, 4, 2):
        heights = []
        for j, (term, gloss) in enumerate(FORM[i:i + 2]):
            x = xs[j]
            dr.text((x, row_y), term, font=f_term, fill=GOLD_LIGHT)
            gy = row_y + 24 * S
            for ln in wrap(dr, gloss, f_gloss, col_w):
                dr.text((x, gy), ln, font=f_gloss, fill=TEXT_LIGHT)
                gy += 23 * S
            heights.append(gy - row_y)
        row_y += max(heights) + 14 * S
    y = row_y + 2 * S
    key1, key2, key3 = "One fitted formula, same for all 136 teams.  ", "+", "/− is each team's offseason move."
    dr.text((PAD, y), key1, font=f_movekey, fill=TEXT_LIGHT)
    kx = PAD + dr.textlength(key1, font=f_movekey)
    dr.text((kx, y), key2, font=f_movekey, fill=SAGE_LIGHT)
    kx += dr.textlength(key2, font=f_movekey)
    dr.text((kx, y), "/−", font=f_movekey, fill=RUST_LIGHT)
    kx += dr.textlength("/−", font=f_movekey)
    dr.text((kx, y), " is each team's offseason move.", font=f_movekey, fill=TEXT_LIGHT)
    y += 26 * S

    # ── Gold rule ──
    dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
    y += 14 * S

    # ── Two-column list, 13 + 12 ──
    lcol_w = (W - 2 * PAD - 56 * S) // 2
    row_h = 50 * S
    for j, chunk in enumerate((rows[:13], rows[13:])):
        x0 = PAD + j * (lcol_w + 56 * S)
        yy = y
        for i, r in enumerate(chunk):
            rank = str((j * 13) + i + 1)
            base = yy + 10 * S
            dr.text((x0 + 46 * S - dr.textlength(rank, font=f_rank), base - 4 * S),
                    rank, font=f_rank, fill=GOLD_LIGHT)
            mv = float(r.get("offseason_delta") or 0.0)
            mv_txt = f"{mv:+.1f}" if abs(mv) >= 0.05 else "0.0"
            mv_col = SAGE_LIGHT if mv >= 0.05 else (RUST_LIGHT if mv <= -0.05 else TEXT_LIGHT)
            mv_w = dr.textlength(mv_txt, font=f_move)
            rating = f"{float(r.get('rating') or 0):.1f}"
            rat_w = dr.textlength(rating, font=f_rating)
            right = x0 + lcol_w
            dr.text((right - mv_w, base + 2 * S), mv_txt, font=f_move, fill=mv_col)
            dr.text((right - 64 * S - rat_w, base + 2 * S), rating,
                    font=f_rating, fill=TEXT_LIGHT)
            team_x = x0 + 62 * S
            team_max = right - 64 * S - rat_w - 16 * S - team_x
            dr.text((team_x, base - 2 * S),
                    ellipsize(dr, str(r.get("team") or ""), f_team, team_max),
                    font=f_team, fill=CREAM)
            yy += row_h
            if i < len(chunk) - 1:
                dr.line([x0, yy, x0 + lcol_w, yy], fill=DIVIDER, width=1 * S)
                yy += 1 * S
    y = y + 13 * row_h + 12 * S + 10 * S

    # ── Footer ──
    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 26 * S
    dr.text((PAD, fy), "pressboxanalytics.com", font=f_footurl, fill=GOLD_LIGHT)
    note = "FIT ON 2022–25 · FROZEN FOR 2026 · THE SEASON GRADES IT"
    dr.text((W - PAD - dr.textlength(note, font=f_footnote), fy + 12 * S),
            note, font=f_footnote, fill=TEXT_LIGHT)
    total_h = fy + 60 * S

    img = img.crop((0, 0, W, total_h))
    img.save(out_path, "PNG")
    print(f"wrote {out_path} ({W}x{total_h})")


if __name__ == "__main__":
    main()

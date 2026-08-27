# -*- coding: utf-8 -*-
"""Render the Projected Records card as a PNG, from the live board.

    py -X utf8 tools/records_card.py [out.png]

Same dark-card frame as tools/top25_card.py, same team order as the Top 25.
Record = EXPECTED WINS (every game's win probability, summed) rounded to the
nearest whole game — Austin, 2026-08-27: being favored in all twelve doesn't
make you 12-0, and the old most-likely record printed exactly that.
"""
import json
import os
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFont

S = 2
W = 1080 * S
PAD = 64 * S

INK = (15, 14, 10)
CREAM = (248, 245, 238)
GOLD = (184, 146, 42)
GOLD_LIGHT = (231, 190, 77)
TEXT_LIGHT = (163, 154, 136)
DIVIDER = (45, 44, 40)

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow   = font("seguisb.ttf", 17)
f_title     = font("georgiab.ttf", 84)
f_gloss     = font("segoeui.ttf", 16)
f_headright = font("seguisb.ttf", 15)
f_rank      = font("georgiab.ttf", 27)
f_team      = font("georgiab.ttf", 24)
f_rec       = font("georgiab.ttf", 26)
f_footurl   = font("georgiab.ttf", 26)
f_footnote  = font("seguisb.ttf", 14)

GLOSS = ("Projected record = every game's win probability, summed across the "
         "schedule and rounded to the nearest whole game. Being favored in all "
         "twelve doesn't make you 12–0 — twelve games you're 85% to win add up "
         "to about ten, and that's what a season actually does. Teams listed in "
         "PressBox Top 25 order.")


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


def logo():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    return Image.open(p).convert("RGBA") if os.path.exists(p) else None


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "records25.png"
    d = json.load(urllib.request.urlopen(
        "https://betbuddy-backend.onrender.com/rankings/teams?season=2026&offseason=1",
        timeout=120))
    rows = sorted(d.get("teams") or [],
                  key=lambda r: -(r.get("rating") or -99))[:25]
    if len(rows) < 25:
        sys.exit(f"board returned {len(rows)} teams")

    img = Image.new("RGB", (W, 3200 * S), INK)
    dr = ImageDraw.Draw(img)

    y = 48 * S
    lg = logo()
    logo_h = 104 * S
    if lg:
        ratio = logo_h / lg.height
        lgr = lg.resize((int(lg.width * ratio), logo_h), Image.LANCZOS)
        img.paste(lgr, (PAD, y), lgr)
    hr = "COLLEGE FOOTBALL · 2026"
    dr.text((W - PAD - dr.textlength(hr, font=f_headright), y + logo_h - 30 * S),
            hr, font=f_headright, fill=TEXT_LIGHT)
    y += logo_h + 26 * S

    dr.text((PAD, y), "PRESSBOX POWER RATINGS", font=f_eyebrow, fill=GOLD_LIGHT)
    y += 30 * S
    dr.text((PAD, y), "Projected Records", font=f_title, fill=CREAM)
    y += 112 * S

    for ln in wrap(dr, GLOSS, f_gloss, W - 2 * PAD - 60 * S):
        dr.text((PAD, y), ln, font=f_gloss, fill=TEXT_LIGHT)
        y += 23 * S
    y += 14 * S

    dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
    y += 14 * S

    lcol_w = (W - 2 * PAD - 56 * S) // 2
    row_h = 50 * S
    for j, chunk in enumerate((rows[:13], rows[13:])):
        x0 = PAD + j * (lcol_w + 56 * S)
        yy = y
        for i, r in enumerate(chunk):
            rank = str((j * 13) + i + 1)
            by = yy + 33 * S      # one shared text baseline per row
            dr.text((x0 + 46 * S, by), rank, font=f_rank, fill=GOLD_LIGHT, anchor="rs")
            ew = float(r.get("expected_wins") or 0.0)
            gc = int(r.get("games_counted") or 0)
            wns = int(round(ew))
            rec = f"{wns}–{max(0, gc - wns)}"
            rec_w = dr.textlength(rec, font=f_rec)
            right = x0 + lcol_w
            dr.text((right, by), rec, font=f_rec, fill=CREAM, anchor="rs")
            team_x = x0 + 62 * S
            team_max = right - rec_w - 20 * S - team_x
            dr.text((team_x, by),
                    ellipsize(dr, str(r.get("team") or ""), f_team, team_max),
                    font=f_team, fill=CREAM, anchor="ls")
            yy += row_h
            if i < len(chunk) - 1:
                dr.line([x0, yy, x0 + lcol_w, yy], fill=DIVIDER, width=1 * S)
                yy += 1 * S
    y = y + 13 * row_h + 12 * S + 10 * S

    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 26 * S
    dr.text((PAD, fy), "pressboxanalytics.com", font=f_footurl, fill=GOLD_LIGHT)
    note = "EXPECTED WINS, ROUNDED · FULL 2026 SLATES · THE SEASON GRADES IT"
    dr.text((W - PAD - dr.textlength(note, font=f_footnote), fy + 12 * S),
            note, font=f_footnote, fill=TEXT_LIGHT)
    total_h = fy + 60 * S

    img.crop((0, 0, W, total_h)).save(out_path, "PNG")
    print(f"wrote {out_path} ({W}x{total_h})")


if __name__ == "__main__":
    main()

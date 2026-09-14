# -*- coding: utf-8 -*-
"""Top-25 POWER RANKINGS + movement card — the current board vs the
ORIGINAL preseason board (rankings_preseason.json, week-0 asof +
offseason prior; Austin: "let's go from the original rankings").

    py -X utf8 tools/top25_movement_card.py [out.png] [week_label]

Rows: rank, team, movement vs the preseason board in POSITIONS
(Ohio State 2 -> 1 = up 1). No rating numbers anywhere (Austin 9/7).
Below: biggest risers and fallers across all of FBS by places moved.
"""
import json
import os
import sys
import urllib.request

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
SAGE = (107, 160, 107)
RUST = (209, 122, 74)
DIM = (74, 70, 60)

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow  = font("seguisb.ttf", 17)
f_title    = font("georgiab.ttf", 64)
f_gloss    = font("segoeui.ttf", 16)
f_rank     = font("georgiab.ttf", 22)
f_row      = font("seguisb.ttf", 19)
f_rating   = font("seguisb.ttf", 18)
f_move     = font("seguisb.ttf", 14)
f_sect     = font("seguisb.ttf", 15)
f_footurl  = font("georgiab.ttf", 26)
f_footnote = font("seguisb.ttf", 13)

API = "https://betbuddy-backend.onrender.com"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_boards():
    cur = json.load(urllib.request.urlopen(
        f"{API}/rankings/teams?season=2026&offseason=1", timeout=180))
    pre = json.load(open(os.path.join(HERE, "rankings_preseason.json"),
                         encoding="utf-8-sig"))
    def ranked(payload):
        teams = sorted(payload["teams"], key=lambda t: -float(t["rating"]))
        return {t["team"]: (i + 1, float(t["rating"]))
                for i, t in enumerate(teams)}
    return ranked(cur), ranked(pre)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "top25_movement.png"
    wk = sys.argv[2] if len(sys.argv) > 2 else "WEEK 1 IN THE BOOKS"
    cur, pre = load_boards()
    board = sorted(cur.items(), key=lambda kv: kv[1][0])
    top25 = board[:25]
    # Movement = POSITIONS on the board, preseason -> now (Austin, 9/7:
    # "show change in position, not our numbers that nobody cares about").
    deltas = []
    for team, (rk, rating) in cur.items():
        if team in pre:
            p_rk, p_rt = pre[team]
            deltas.append((team, p_rk - rk, p_rk, rk))
    risers = sorted(deltas, key=lambda d: -d[1])[:5]
    fallers = sorted(deltas, key=lambda d: d[1])[:5]

    img = Image.new("RGB", (W, 3600 * S), INK)
    dr = ImageDraw.Draw(img)
    y = 44 * S
    lp = os.path.join(HERE, "pressbox-w2a-ink-cropped.png")
    if os.path.exists(lp):
        lg = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        lg = lg.resize((int(lg.width * h_ / lg.height), h_), Image.LANCZOS)
        img.paste(lg, (PAD, y), lg)
    dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL · 2026", font=f_sect,
            fill=TEXT_LIGHT, anchor="rs")
    y += 96 * S + 22 * S

    dr.text((PAD, y), f"POWER RANKINGS · {wk.upper()}", font=f_eyebrow,
            fill=GOLD_LIGHT)
    y += 30 * S
    dr.text((PAD, y), "The new Top 25.", font=f_title, fill=CREAM)
    y += 92 * S
    gloss = ("Our four opponent-adjusted models, blended and re-ranked "
             "after every game weekend. Movement is measured against the "
             "ORIGINAL preseason board, so the arrows carry everything a "
             "team has shown so far, not just one Saturday.")
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
    y = gy + 32 * S
    dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
    y += 24 * S

    def move_chip(team, rk):
        if team not in pre:
            return ("NEW", GOLD_LIGHT)
        p_rk, _ = pre[team]
        dr_ = p_rk - rk
        if dr_ > 0:
            return (f"▲ {dr_}", SAGE)
        if dr_ < 0:
            return (f"▼ {abs(dr_)}", RUST)
        return ("—", DIM)

    for team, (rk, rating) in top25:
        base = y + 26 * S
        dr.text((PAD, base), f"{rk}", font=f_rank, fill=GOLD_LIGHT, anchor="ls")
        dr.text((PAD + 52 * S, base), team, font=f_row, fill=CREAM, anchor="ls")
        chip, col = move_chip(team, rk)
        dr.text((W - PAD, base), chip, font=f_rating, fill=col, anchor="rs")
        if team in pre and pre[team][0] != rk:
            dr.text((W - PAD - 110 * S, base), f"was #{pre[team][0]}",
                    font=f_move, fill=TEXT_LIGHT, anchor="rs")
        y += 46 * S
        dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
        y += 5 * S

    for lbl, group, col in (("BIGGEST RISERS SINCE THE PRESEASON", risers, SAGE),
                            ("BIGGEST FALLERS SINCE THE PRESEASON", fallers, RUST)):
        y += 18 * S
        dr.text((PAD, y + 12 * S), lbl, font=f_sect, fill=GOLD_LIGHT, anchor="ls")
        y += 28 * S
        for team, dpl, p_rk, rk in group:
            base = y + 24 * S
            dr.text((PAD, base), f"{team}", font=f_row, fill=CREAM, anchor="ls")
            dr.text((PAD + 340 * S, base), f"#{p_rk} → #{rk}", font=f_move,
                    fill=TEXT_LIGHT, anchor="ls")
            mv = (f"▲ {dpl} spots" if dpl > 0
                  else f"▼ {abs(dpl)} spots" if dpl < 0 else "—")
            dr.text((W - PAD, base), mv, font=f_rating,
                    fill=col if dpl else DIM, anchor="rs")
            y += 42 * S
            dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
            y += 5 * S

    y += 16 * S
    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 26 * S
    dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
            fill=GOLD_LIGHT, anchor="ls")
    dr.text((W - PAD, fy + 22 * S),
            "FOUR MODELS · OPPONENT-ADJUSTED · REBUILT EVERY WEEK",
            font=f_footnote, fill=TEXT_LIGHT, anchor="rs")
    img.crop((0, 0, W, fy + 52 * S)).save(out, "PNG")
    print(f"wrote {out} | top25 + {len(risers)} risers / {len(fallers)} fallers")


if __name__ == "__main__":
    main()

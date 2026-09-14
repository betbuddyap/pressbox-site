# -*- coding: utf-8 -*-
"""OVER/UNDERPERFORMERS of the week — efficiency-adjusted margin vs
what the preseason board expected of the matchup (rating gap + 2.5
home field). TWO separate card images, one post each (Austin 9/7:
paired-row single card didn't land; a team's over IS the opponent's
under, so the two posts are honest mirrors shown apart).

    py -X utf8 tools/week_performers_card.py [out_prefix] [start] [end]

Writes <out_prefix>_over.png and <out_prefix>_under.png.
Data: game breakdowns (adjusted_score) + rankings_preseason.json.
FCS opponents sit out (no play-level data / no rating).
"""
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

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
HFA = 2.5

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow  = font("seguisb.ttf", 17)
f_title    = font("georgiab.ttf", 64)
f_gloss    = font("segoeui.ttf", 16)
f_row      = font("seguisb.ttf", 19)
f_rowsub   = font("segoeui.ttf", 14)
f_val      = font("seguisb.ttf", 18)
f_sect     = font("seguisb.ttf", 15)
f_footurl  = font("georgiab.ttf", 26)
f_footnote = font("seguisb.ttf", 13)

ANON = "sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE"
API = "https://betbuddy-backend.onrender.com"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get(url, headers=None, timeout=90):
    req = urllib.request.Request(url, headers=headers or {})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def main():
    prefix = sys.argv[1] if len(sys.argv) > 1 else "week_performers"
    prefix = prefix[:-4] if prefix.lower().endswith(".png") else prefix
    start = sys.argv[2] if len(sys.argv) > 2 else "2026-09-10"
    end = sys.argv[3] if len(sys.argv) > 3 else "2026-09-16"

    pre = json.load(open(os.path.join(HERE, "rankings_preseason.json"),
                         encoding="utf-8-sig"))
    rating = {t["team"]: float(t["rating"]) for t in pre["teams"]}

    games = get(
        "https://brwalcuodwxsynrpiqjc.supabase.co/rest/v1/games"
        f"?season=eq.2026&status=eq.final&start_date=gte.{start}"
        f"&start_date=lt.{end}"
        "&select=id,home_team,away_team,neutral_site&order=start_date&limit=120",
        headers={"apikey": ANON})

    def one(g):
        for _ in range(3):
            try:
                return g, get(f"{API}/canonical/games/{g['id']}/breakdown")
            except Exception:
                pass
        return g, None

    perf = []   # (team, delta, note)
    with ThreadPoolExecutor(4) as ex:
        for g, d in ex.map(one, games):
            adj = (d or {}).get("adjusted_score")
            h, a = g["home_team"], g["away_team"]
            if (not adj or adj.get("home") is None
                    or h not in rating or a not in rating):
                continue
            hfa = 0.0 if g.get("neutral_site") else HFA
            exp_h = rating[h] - rating[a] + hfa      # expected home margin
            adj_h = float(adj["home"]) - float(adj["away"])
            delta = adj_h - exp_h

            def side(m):
                if abs(m) < 0.75:
                    return "even"
                return f"{h if m > 0 else a} by {abs(m):.0f}"

            note = f"Expected: {side(exp_h)} · Played like: {side(adj_h)}"
            perf.append((h, delta, f"vs {a} · {note}"))
            perf.append((a, -delta, f"at {h} · {note}"))

    if not perf:
        print("no adjusted finals with ratings in window")
        return
    n_games = len(perf) // 2
    over = sorted(perf, key=lambda p: -p[1])[:10]
    under = sorted(perf, key=lambda p: p[1])[:10]

    def render(out, title, gloss, sect_lbl, group, col, sign):
        img = Image.new("RGB", (W, 2600 * S), INK)
        dr = ImageDraw.Draw(img)
        y = 44 * S
        lp = os.path.join(HERE, "pressbox-w2a-ink-cropped.png")
        if os.path.exists(lp):
            lg = Image.open(lp).convert("RGBA")
            h_ = 96 * S
            lg = lg.resize((int(lg.width * h_ / lg.height), h_),
                           Image.LANCZOS)
            img.paste(lg, (PAD, y), lg)
        dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL · 2026",
                font=f_sect, fill=TEXT_LIGHT, anchor="rs")
        y += 96 * S + 22 * S

        dr.text((PAD, y), "THE WEEKEND VS EXPECTATIONS", font=f_eyebrow,
                fill=GOLD_LIGHT)
        y += 30 * S
        f_t = f_title
        for size in (64, 56, 50, 44):
            f_t = font("georgiab.ttf", size)
            if dr.textlength(title, font=f_t) <= W - 2 * PAD:
                break
        dr.text((PAD, y), title, font=f_t, fill=CREAM)
        y += 92 * S
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
        y += 38 * S
        dr.text((PAD, y + 12 * S), sect_lbl, font=f_sect, fill=GOLD_LIGHT,
                anchor="ls")
        y += 28 * S
        for team, delta, note in group:
            base = y + 26 * S
            dr.text((PAD, base), team, font=f_row, fill=CREAM, anchor="ls")
            dr.text((PAD, base + 20 * S), note, font=f_rowsub,
                    fill=TEXT_LIGHT, anchor="ls")
            dr.text((W - PAD, base), f"{sign}{abs(delta):.0f} pts",
                    font=f_val, fill=col, anchor="rs")
            y += 60 * S
            dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
            y += 6 * S

        y += 16 * S
        dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
        fy = y + 26 * S
        dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
                fill=GOLD_LIGHT, anchor="ls")
        dr.text((W - PAD, fy + 22 * S),
                "EFFICIENCY-ADJUSTED · AGAINST THE PRESEASON NUMBER",
                font=f_footnote, fill=TEXT_LIGHT, anchor="rs")
        img.crop((0, 0, W, fy + 52 * S)).save(out, "PNG")
        print(f"wrote {out} | {n_games} games scored | {len(group)} rows")

    gloss_over = ("The teams that played furthest above what the preseason "
                  "board expected of their matchup — efficiency-adjusted "
                  "margin against the rating gap plus home field. "
                  "Scoreboards flatter and rob; this is played performance "
                  "against the number the models set before the season. "
                  "FCS games sit out.")
    gloss_under = ("The teams that played furthest below what the preseason "
                   "board expected of their matchup — efficiency-adjusted "
                   "margin against the rating gap plus home field. "
                   "Scoreboards flatter and rob; this is played performance "
                   "against the number the models set before the season. "
                   "FCS games sit out.")
    render(f"{prefix}_over.png", "The overperformers.", gloss_over,
           "BEAT THE NUMBER BY THE MOST", over, SAGE, "+")
    render(f"{prefix}_under.png", "The underperformers.", gloss_under,
           "FELL SHORT OF THE NUMBER BY THE MOST", under, RUST, "−")


if __name__ == "__main__":
    main()

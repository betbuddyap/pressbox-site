# -*- coding: utf-8 -*-
"""Weekend ADJUSTED RESULTS card — every final's actual score next to the
efficiency-adjusted score (league_ppg + off_ppa premium x 65 plays), in
the board-card chassis. Sorted by how far the scoreboard drifted from
the efficiency truth; the biggest gaps lead.

    py -X utf8 tools/week_adjusted_card.py [out.png] [start] [end]

Data: public game breakdowns (adjusted_score lands with the morning PPA
pull — a final missing it is skipped and counted).
"""
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
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
SAGE = (107, 160, 107)
RUST = (209, 122, 74)
DIM = (74, 70, 60)
ET = ZoneInfo("America/New_York")

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow  = font("seguisb.ttf", 17)
f_title    = font("georgiab.ttf", 64)
f_gloss    = font("segoeui.ttf", 16)
f_row      = font("seguisb.ttf", 18)
f_rowsub   = font("segoeui.ttf", 14)
f_score    = font("seguisb.ttf", 18)
f_sect     = font("seguisb.ttf", 15)
f_footurl  = font("georgiab.ttf", 26)
f_footnote = font("seguisb.ttf", 13)

ANON = "sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE"
API = "https://betbuddy-backend.onrender.com"


def get(url, headers=None, timeout=90):
    req = urllib.request.Request(url, headers=headers or {})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def fetch_rows(start, end):
    games = get(
        "https://brwalcuodwxsynrpiqjc.supabase.co/rest/v1/games"
        f"?season=eq.2026&status=eq.final&start_date=gte.{start}"
        f"&start_date=lt.{end}"
        "&select=id,home_team,away_team,home_points,away_points,start_date"
        "&order=start_date&limit=120",
        headers={"apikey": ANON})

    missing = []

    def one(g):
        for _ in range(3):
            try:
                d = get(f"{API}/canonical/games/{g['id']}/breakdown")
                return g, d
            except Exception:
                pass
        return g, None

    rows = []
    with ThreadPoolExecutor(4) as ex:
        for g, d in ex.map(one, games):
            adj = (d or {}).get("adjusted_score")
            if not d or not adj or adj.get("away") is None or adj.get("home") is None:
                missing.append(f"{g['away_team']} @ {g['home_team']}")
                continue
            a_act = adj.get("away_actual", g["away_points"])
            h_act = adj.get("home_actual", g["home_points"])
            a_adj = round(float(adj["away"]))
            h_adj = round(float(adj["home"]))
            gap = abs((h_adj - a_adj) - (h_act - a_act))
            rows.append(dict(
                matchup=f"{g['away_team']} @ {g['home_team']}",
                kick=g["start_date"], a_act=a_act, h_act=h_act,
                a_adj=a_adj, h_adj=h_adj, gap=gap,
                flipped=((h_act - a_act) * (h_adj - a_adj) < 0)))
    rows.sort(key=lambda r: -r["gap"])
    return rows, missing


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "week_adjusted.png"
    start = sys.argv[2] if len(sys.argv) > 2 else "2026-09-10"
    end = sys.argv[3] if len(sys.argv) > 3 else "2026-09-16"
    rows, missing = fetch_rows(start, end)
    if not rows:
        print("no adjusted finals in window; missing:", len(missing))
        return

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    logo = None
    if os.path.exists(lp):
        logo = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        logo = logo.resize((int(logo.width * h_ / logo.height), h_),
                           Image.LANCZOS)

    meas = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    gloss = (f"All {len(rows)} FBS-vs-FBS finals — every game, not just "
             "our picks — re-scored on per-play efficiency: league scoring "
             "plus each offense's efficiency premium over a normal game's "
             "65 plays. Garbage time, short fields, and fluke bounces wash "
             "out; the biggest drifts lead. Δ is how far the scoreboard "
             "margin sat from the played one. VERDICT FLIPPED marks a game "
             "whose scoreboard loser won the game that was played. "
             f"The weekend's {len(missing)} FCS-opponent games sit out "
             "(no play-level data).")
    gloss_lines, line_ = [], ""
    for w_ in gloss.split():
        t_ = (line_ + " " + w_).strip()
        if meas.textlength(t_, font=f_gloss) <= W - 2 * PAD:
            line_ = t_
        else:
            gloss_lines.append(line_)
            line_ = w_
    if line_:
        gloss_lines.append(line_)

    # Paginated like the board card (Austin 9/7: "that's so tall") —
    # ~4100px per card, full header on card 1, slim after, footer on all.
    ROW_H = 68 * S
    HEAD_FULL = (284 + len(gloss_lines) * 23 + 9 + 30) * S
    HEAD_SLIM = 224 * S
    FOOT = 90 * S
    CAP = 2050 * S
    pages, i = [], 0
    while i < len(rows):
        head = HEAD_FULL if not pages else HEAD_SLIM
        n = max(1, int((CAP - head - FOOT) // ROW_H))
        pages.append(rows[i:i + n])
        i += n
    N = len(pages)

    stem = out[:-4] if out.lower().endswith(".png") else out
    outs = []
    for pi, page in enumerate(pages, 1):
        head = HEAD_FULL if pi == 1 else HEAD_SLIM
        img = Image.new("RGB", (W, head + len(page) * ROW_H + FOOT + 60 * S),
                        INK)
        dr = ImageDraw.Draw(img)
        y = 44 * S
        if logo:
            img.paste(logo, (PAD, y), logo)
        dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL · 2026",
                font=f_sect, fill=TEXT_LIGHT, anchor="rs")
        y += 96 * S + 22 * S

        eyebrow = "THE WEEKEND, EFFICIENCY-ADJUSTED"
        if N > 1:
            eyebrow += f" · {pi} OF {N}"
        dr.text((PAD, y), eyebrow, font=f_eyebrow, fill=GOLD_LIGHT)
        y += 30 * S
        if pi == 1:
            title = "What the scores should've been."
            f_t = f_title
            for size in (64, 58, 52, 46):
                f_t = font("georgiab.ttf", size)
                if dr.textlength(title, font=f_t) <= W - 2 * PAD:
                    break
            dr.text((PAD, y), title, font=f_t, fill=CREAM)
            y += 92 * S
            for ln in gloss_lines:
                dr.text((PAD, y), ln, font=f_gloss, fill=TEXT_LIGHT)
                y += 23 * S
            y += 9 * S
        dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
        y += 26 * S

        for r in page:
            base = y + 26 * S
            dr.text((PAD, base), r["matchup"], font=f_row, fill=CREAM,
                    anchor="ls")
            day = datetime.fromisoformat(r["kick"].replace("Z", "+00:00")) \
                .astimezone(ET)
            day_s = (day.strftime("%a %#m/%#d") if os.name == "nt"
                     else day.strftime("%a %-m/%-d"))
            sub = day_s + (" · VERDICT FLIPPED" if r["flipped"] else "")
            dr.text((PAD, base + 20 * S), sub, font=f_rowsub,
                    fill=(GOLD_LIGHT if r["flipped"] else TEXT_LIGHT),
                    anchor="ls")
            # actual → adjusted, then the delta as the headline number
            # (Austin 9/7: "show the actual score and then the adjusted
            # score... and then show the delta").
            delta = f"Δ {r['gap']}"
            dr.text((W - PAD, base), delta, font=f_score, fill=GOLD_LIGHT,
                    anchor="rs")
            dw = dr.textlength(delta, font=f_score)
            adj = f"{r['a_adj']}–{r['h_adj']}"
            act = f"{r['a_act']}–{r['h_act']}"
            ax_r = W - PAD - dw - 44 * S
            dr.text((ax_r, base), adj, font=f_score, fill=CREAM, anchor="rs")
            aw = dr.textlength(adj, font=f_score)
            dr.text((ax_r - aw - 16 * S, base), "→", font=f_row,
                    fill=GOLD_LIGHT, anchor="rs")
            arw = dr.textlength("→", font=f_row)
            dr.text((ax_r - aw - arw - 32 * S, base), act, font=f_score,
                    fill=TEXT_LIGHT, anchor="rs")
            dr.text((W - PAD, base + 20 * S), "actual → adjusted · delta",
                    font=f_rowsub, fill=DIM, anchor="rs")
            y += 62 * S
            dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
            y += 6 * S

        y += 12 * S
        dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
        fy = y + 26 * S
        dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
                fill=GOLD_LIGHT, anchor="ls")
        dr.text((W - PAD, fy + 22 * S),
                "EFFICIENCY-ADJUSTED SCORING · EVERY FINAL, EVERY WEEK",
                font=f_footnote, fill=TEXT_LIGHT, anchor="rs")
        name = out if N == 1 else f"{stem}_{pi}of{N}.png"
        img.crop((0, 0, W, fy + 52 * S)).save(name, "PNG")
        outs.append(name)
    print(f"wrote {' + '.join(outs)} | {len(rows)} finals | "
          f"flipped {sum(1 for r in rows if r['flipped'])} | "
          f"missing adj {len(missing)} | pages {N}")
    if missing:
        print("  missing:", "; ".join(missing[:6]) + (" …" if len(missing) > 6 else ""))


if __name__ == "__main__":
    main()

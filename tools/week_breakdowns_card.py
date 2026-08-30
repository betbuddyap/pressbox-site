# -*- coding: utf-8 -*-
"""Weekly pick-by-pick breakdowns, grouped by game.

    py -X utf8 tools/week_breakdowns_card.py [out.png] [start] [end]

One block per game that carries at least one graded pick (graded at
either end — released with a grade, or grown into one). Every pick gets:
the badge path (release → now when it moved), the bet as released with
price and book, the allocator's current stake, the RULES firing now by
name, the bloc's historical record, and a held/why line. Shares fetch,
badges, sizing, and why-lines with week_board_card so the two can never
tell different stories.
"""
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from week_board_card import (fetch_rows, allocator_units, sizing_prob_dec,
                             badge, why_line,
                             TIER_LBL, MKT, INK, CREAM, GOLD, GOLD_LIGHT,
                             TEXT_LIGHT, DIVIDER, DIM, S, W, PAD, font)

f_eyebrow  = font("seguisb.ttf", 17)
f_title    = font("georgiab.ttf", 64)
f_gloss    = font("segoeui.ttf", 16)
f_game     = font("georgiab.ttf", 24)
f_gmeta    = font("seguisb.ttf", 13)
f_row      = font("seguisb.ttf", 17)
f_mkt      = font("seguisb.ttf", 12)
f_sub      = font("segoeui.ttf", 14)
f_footurl  = font("georgiab.ttf", 26)
f_footnote = font("seguisb.ttf", 13)

ET = ZoneInfo("America/New_York")


def kick_lbl(iso):
    d = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET)
    day = d.strftime("%a %#m/%#d") if os.name == "nt" else d.strftime("%a %-m/%-d")
    tm = d.strftime("%#I:%M %p ET") if os.name == "nt" else d.strftime("%-I:%M %p ET")
    return f"{day} · {tm}"


def wrap(dr, text, fnt, width):
    words, line, out = text.split(), "", []
    for w_ in words:
        t = (line + " " + w_).strip()
        if dr.textlength(t, font=fnt) <= width:
            line = t
        else:
            out.append(line)
            line = w_
    if line:
        out.append(line)
    return out


def draw_game_block(dr, y, matchup, kick, picks, stakes):
    """One game block; returns the new y. Drawn identically on the
    measuring pass and the real pass."""
    dr.text((PAD, y + 20 * S), matchup, font=f_game, fill=CREAM, anchor="ls")
    dr.text((W - PAD, y + 20 * S), kick_lbl(kick), font=f_gmeta,
            fill=TEXT_LIGHT, anchor="rs")
    y += 36 * S
    for r in picks:
        base = y + 26 * S
        moved = r["ct"] != r["rt"]
        bx = PAD
        bw = badge(dr, bx, base, r["rt"])
        bx += bw
        if moved:
            bx += 8 * S
            dr.text((bx, base - 4 * S), "→", font=f_row, fill=TEXT_LIGHT,
                    anchor="ls")
            bx += dr.textlength("→", font=f_row) + 8 * S
            bx += badge(dr, bx, base, r["ct"])
        bx += 14 * S
        rl = r["rl"]
        if (r["market"] or "").startswith("m") and rl is not None:
            try:
                if float(str(rl).replace("−", "-")) > 0:
                    rl = f"+{rl}"
            except (TypeError, ValueError):
                pass
        px = f" ({r['rp']})" if r.get("rp") else ""
        bk = f" at {r['rbook']}" if r.get("rbook") else ""
        bet = (f"{r['rs']} {rl}" if rl is not None else f"{r['rs']}") + px + bk
        dr.text((bx, base), bet, font=f_row, fill=CREAM, anchor="ls")
        tw = dr.textlength(bet, font=f_row)
        dr.text((bx + tw + 10 * S, base), MKT.get(r["market"], ""),
                font=f_mkt, fill=GOLD_LIGHT, anchor="ls")
        st = stakes.get((r["gid"], r["market"]))
        dr.text((W - PAD, base), f"{st:.1f}u" if st else "—", font=f_row,
                fill=GOLD_LIGHT if st else DIM, anchor="rs")
        y = base + 12 * S
        if r.get("vlabels"):
            fired = " · ".join(r["vlabels"][:2])
            if len(r["vlabels"]) > 2:
                fired += f"  (+{len(r['vlabels']) - 2} more)"
            for line in wrap(dr, "firing: " + fired, f_sub,
                             W - 2 * PAD - 20 * S)[:2]:
                dr.text((PAD + 16 * S, y + 14 * S), line, font=f_sub,
                        fill=TEXT_LIGHT, anchor="ls")
                y += 20 * S
        p, dec = sizing_prob_dec(r)
        if p and dec and dec > 1:
            dr.text((PAD + 16 * S, y + 14 * S),
                    f"prices at {p * 100:.1f}% vs {100 / dec:.1f}% break-even",
                    font=f_sub, fill=CREAM, anchor="ls")
            y += 20 * S
        if r.get("hist_rate") is not None:
            n = r.get("hist_n")
            ml_tag = (", all prices"
                      if (r["market"] or "").startswith("m") else "")
            rec = (f"raw signal record {round(r['hist_rate'] * 100)}% "
                   f"in 2023–25" + (f" ({n} fires{ml_tag})" if n else ""))
            dr.text((PAD + 16 * S, y + 14 * S), rec, font=f_sub,
                    fill=TEXT_LIGHT, anchor="ls")
            y += 20 * S
        if moved:
            for line in wrap(dr, why_line(r), f_sub,
                             W - 2 * PAD - 20 * S)[:3]:
                dr.text((PAD + 16 * S, y + 14 * S), line, font=f_sub,
                        fill=GOLD_LIGHT, anchor="ls")
                y += 20 * S
        y += 12 * S
    dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
    y += 18 * S
    return y


def draw_tickets_block(dr, y, tickets):
    dr.text((PAD, y + 12 * S), "THE PARLAYS ON THE SHEET", font=f_eyebrow,
            fill=GOLD_LIGHT, anchor="ls")
    y += 30 * S
    for t in tickets:
        base = y + 24 * S
        dr.text((PAD, base), t["name"], font=f_row, fill=CREAM, anchor="ls")
        nw = dr.textlength(t["name"], font=f_row)
        dr.text((PAD + nw + 10 * S, base), f"+{(t['dec'] - 1) * 100:.0f}",
                font=f_row, fill=GOLD, anchor="ls")
        st = t.get("stake") or 0.0
        dr.text((W - PAD, base), f"{st:.1f}u" if st else "—", font=f_row,
                fill=GOLD_LIGHT if st else DIM, anchor="rs")
        legs = "  ·  ".join(
            (f"{x['cs']} {x['cl']}" if x["cl"] is not None else f"{x['cs']}")
            + (f" ({x['matchup'].split(' @ ')[-1]})"
               if (x.get("cs") or "").split(" ")[0] in ("Over", "Under") else "")
            for x in t["legs"])
        dr.text((PAD, base + 19 * S), legs, font=f_sub, fill=TEXT_LIGHT,
                anchor="ls")
        y += 56 * S
    return y


PAGE_BUDGET = 2050 * S     # content cutoff — keeps a page ~4300px tall


def draw_header(img, dr, page, pages, gloss_lines):
    y = 44 * S
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    if os.path.exists(lp):
        lg = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        lg = lg.resize((int(lg.width * h_ / lg.height), h_), Image.LANCZOS)
        img.paste(lg, (PAD, y), lg)
    dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL · 2026", font=f_gmeta,
            fill=TEXT_LIGHT, anchor="rs")
    y += 96 * S + 22 * S
    dr.text((PAD, y), f"WEEK 1 · EVERY GRADED PICK · {page} OF {pages}",
            font=f_eyebrow, fill=GOLD_LIGHT)
    y += 30 * S
    dr.text((PAD, y), "Week 1 Pick Detail", font=f_title, fill=CREAM)
    y += 86 * S
    if page == 1:
        for line in gloss_lines:
            dr.text((PAD, y), line, font=f_gloss, fill=TEXT_LIGHT)
            y += 23 * S
        y += 12 * S
    dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
    return y + 28 * S


def draw_footer(img, dr, y):
    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 26 * S
    dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
            fill=GOLD_LIGHT, anchor="ls")
    dr.text((W - PAD, fy + 22 * S),
            "GRADED ON THE RELEASED LINE · REGRADES ON THE RECORD",
            font=f_footnote, fill=TEXT_LIGHT, anchor="rs")
    return fy + 52 * S


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "week_breakdowns.png"
    start = sys.argv[2] if len(sys.argv) > 2 else "2026-09-01"
    end = sys.argv[3] if len(sys.argv) > 3 else "2026-09-09"
    rows, pool = fetch_rows(start, end)
    stakes, tickets = allocator_units(pool)

    games = {}
    for r in rows:
        games.setdefault((r["kick"], r["matchup"]), []).append(r)

    def game_stake(key):
        return max((stakes.get((r["gid"], r["market"])) or 0.0)
                   for r in games[key])

    # Biggest allocation first; within a game the picks likewise.
    order = sorted(games.keys(), key=lambda k: -game_stake(k))
    for k in order:
        games[k].sort(key=lambda r: -(stakes.get((r["gid"], r["market"])) or 0))

    # ── measuring pass (same draw code on a scratch canvas) ──
    scratch = Image.new("RGB", (W, 4000 * S), INK)
    sdr = ImageDraw.Draw(scratch)
    heights = {}
    for k in order:
        heights[k] = draw_game_block(sdr, 0, k[1], k[0], games[k], stakes)
    tick_h = draw_tickets_block(sdr, 0, tickets) + 16 * S if tickets else 0

    # ── paginate greedily at block boundaries ──
    pages, cur, used = [], [], 0
    for k in order:
        if cur and used + heights[k] > PAGE_BUDGET:
            pages.append(cur)
            cur, used = [], 0
        cur.append(k)
        used += heights[k]
    if tickets and cur and used + tick_h > PAGE_BUDGET:
        pages.append(cur)
        cur, used = [], 0
    if cur or tickets:
        pages.append(cur)

    gloss = (f"Every game carrying a graded pick — {len(rows)} picks across "
             f"{len(order)} games, ordered by the allocator's stake. "
             "“Prices at” is the allocator's own number: the grade's "
             "anchor tilted by its bloc (ML: the tier's ROI floor at this "
             "price). The raw record is each rule's full 2023–25 history "
             "pooled — in-sample, a ceiling. Stakes: Moderate, average "
             "bet = one unit. Grading always settles on the release.")
    gdr = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    gloss_lines = wrap(gdr, gloss, f_gloss, W - 2 * PAD)

    base_out = out[:-4] if out.lower().endswith(".png") else out
    n = len(pages)
    outs = []
    for i, keys in enumerate(pages, 1):
        img = Image.new("RGB", (W, 4600 * S), INK)
        dr = ImageDraw.Draw(img)
        y = draw_header(img, dr, i, n, gloss_lines)
        for k in keys:
            y = draw_game_block(dr, y, k[1], k[0], games[k], stakes)
        if i == n and tickets:
            y = draw_tickets_block(dr, y, tickets) + 16 * S
        total = draw_footer(img, dr, y + 8 * S)
        path = f"{base_out}_{i}of{n}.png"
        img.crop((0, 0, W, total)).save(path, "PNG")
        outs.append(path)
        print(f"wrote {path} ({W}x{total})")
    print(f"pages {n} | games {len(order)} | picks {len(rows)}")


if __name__ == "__main__":
    main()

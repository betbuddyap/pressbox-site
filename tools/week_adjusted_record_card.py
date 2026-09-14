# -*- coding: utf-8 -*-
"""Pick record vs the PLAYED game — every released-graded pick settled
twice: once on the scoreboard (the official record, released lines,
allocator-shape stakes — identical to week_results_card) and once on the
efficiency-adjusted score (rounded, exactly as published on the adjusted
cards). The gap between the two records is scoreboard luck. Flipped
results get their own rows.

    py -X utf8 tools/week_adjusted_record_card.py [out.png] [week]

Picks on FCS-opponent games sit out (no adjusted score); unsettled games
(still to play) sit out of both records.
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
SILVER = (192, 197, 204)
BRONZE = (169, 103, 58)
SAGE = (107, 160, 107)
RUST = (209, 122, 74)
DIM = (74, 70, 60)
ET = ZoneInfo("America/New_York")
MKT = {"spread": "SPREAD", "total": "TOTAL", "moneyline": "ML", "ml": "ML"}

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow  = font("seguisb.ttf", 17)
f_title    = font("georgiab.ttf", 64)
f_gloss    = font("segoeui.ttf", 16)
f_stat     = font("georgiab.ttf", 40)
f_statlab  = font("seguisb.ttf", 13)
f_row      = font("seguisb.ttf", 18)
f_rowsub   = font("segoeui.ttf", 14)
f_badge    = font("seguisb.ttf", 14)
f_mkt      = font("seguisb.ttf", 12)
f_glyph    = font("seguisym.ttf", 20)
f_sect     = font("seguisb.ttf", 15)
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


def settle_adj(pick, home, away, adj_h, adj_a):
    """Result of this pick if the game ended at the ADJUSTED score
    (rounded ints — settle on exactly what the adjusted cards publish)."""
    side = str(pick.get("side") or "")
    market = (pick.get("market") or "").lower()
    line = pick.get("line")
    if side.lower() in ("over", "under") or market == "total":
        if line is None:
            return None
        tot = adj_h + adj_a
        if tot == float(line):
            return "push"
        if side.lower() == "over":
            return "win" if tot > float(line) else "loss"
        return "win" if tot < float(line) else "loss"
    # spread / ML: which side is the pick?
    if side == home:
        margin = adj_h - adj_a
    elif side == away:
        margin = adj_a - adj_h
    elif side and side in home:
        margin = adj_h - adj_a
    elif side and side in away:
        margin = adj_a - adj_h
    else:
        return None
    if market.startswith("m"):
        if margin == 0:
            return "push"
        return "win" if margin > 0 else "loss"
    if line is None:
        return None
    cover = margin + float(line)
    if cover == 0:
        return "push"
    return "win" if cover > 0 else "loss"


def fetch(week):
    d = json.load(urllib.request.urlopen(urllib.request.Request(
        f"{API}/canonical/results/feed?season=2026"), timeout=90))
    tot = n = 0.0
    for s in d.get("sheet") or []:
        if s.get("week") != week:
            continue
        tot += delta_weight(s.get("our_prob"), am_to_dec(s.get("price_raw")))
        n += 1
    games = [g for g in d.get("games") or [] if g.get("week") == week
             and any((p.get("tier") or "no_edge") != "no_edge"
                     for p in g.get("picks") or [])]

    def one(g):
        for _ in range(3):
            try:
                return g, json.load(urllib.request.urlopen(
                    f"{API}/canonical/games/{g['game_id']}/breakdown",
                    timeout=90))
            except Exception:
                pass
        return g, None

    rows, no_adj, pending = [], 0, 0
    with ThreadPoolExecutor(4) as ex:
        for g, brk in ex.map(one, games):
            adj = (brk or {}).get("adjusted_score") or {}
            has_adj = adj.get("home") is not None and adj.get("away") is not None
            adj_h = round(float(adj["home"])) if has_adj else None
            adj_a = round(float(adj["away"])) if has_adj else None
            for p in g.get("picks") or []:
                if not p.get("tier") or p["tier"] == "no_edge":
                    continue
                if p.get("result") not in ("win", "loss", "push"):
                    pending += 1
                    continue
                if not has_adj:
                    no_adj += 1
                    continue
                res_adj = settle_adj(p, g["home_team"], g["away_team"],
                                     adj_h, adj_a)
                if res_adj is None:
                    no_adj += 1
                    continue
                dec = am_to_dec(p.get("price_raw"))
                wgt = delta_weight(p.get("our_prob"), dec)
                stake = (n * wgt / tot) if tot > 0 else 0.0

                def pnl(res):
                    if not stake or res == "push":
                        return 0.0
                    return stake * (dec - 1) if res == "win" else -stake
                rows.append(dict(
                    matchup=g.get("matchup"), kick=g.get("kickoff"),
                    market=p.get("market"), tier=p.get("tier"),
                    side=p.get("side"), line=p.get("line"),
                    act=p["result"], adj=res_adj,
                    act_s=f"{g.get('away_points')}\u2013{g.get('home_points')}",
                    adj_s=f"{adj_a}\u2013{adj_h}",
                    stake=stake, pnl_act=pnl(p["result"]),
                    pnl_adj=pnl(res_adj)))
    return rows, no_adj, pending


def rec(rows, key):
    w = sum(1 for r in rows if r[key] == "win")
    l = sum(1 for r in rows if r[key] == "loss")
    p = sum(1 for r in rows if r[key] == "push")
    return f"{w}\u2013{l}" + (f"\u2013{p}" if p else "")


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


GLYPH = {"win": ("\u2713", SAGE), "loss": ("\u2717", RUST),
         "push": ("\u2014", DIM)}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "week_adjusted_record.png"
    week = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    rows, no_adj, pending = fetch(week)
    if not rows:
        print("no settled, re-scorable picks for week", week)
        return
    flips = [r for r in rows if r["act"] != r["adj"]]
    net_act = sum(r["pnl_act"] for r in rows)
    net_adj = sum(r["pnl_adj"] for r in rows)

    img = Image.new("RGB", (W, 2600 * S), INK)
    dr = ImageDraw.Draw(img)
    y = 44 * S
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    if os.path.exists(lp):
        lg = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        lg = lg.resize((int(lg.width * h_ / lg.height), h_), Image.LANCZOS)
        img.paste(lg, (PAD, y), lg)
    dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL \u00b7 2026",
            font=f_sect, fill=TEXT_LIGHT, anchor="rs")
    y += 96 * S + 22 * S

    dr.text((PAD, y), f"WEEK {week} \u00b7 THE RECORD, RE-SCORED",
            font=f_eyebrow, fill=GOLD_LIGHT)
    y += 30 * S
    title = "Same picks. Played scores."
    f_t = f_title
    for size in (64, 58, 52, 46):
        f_t = font("georgiab.ttf", size)
        if dr.textlength(title, font=f_t) <= W - 2 * PAD:
            break
    dr.text((PAD, y), title, font=f_t, fill=CREAM)
    y += 92 * S
    gloss = (f"Every week-{week} pick settled twice: once on the scoreboard "
             "(the official record \u2014 released lines, allocator stakes) "
             "and once on the efficiency-adjusted score from our adjusted "
             "results. Same bets, same lines, same stakes \u2014 the gap "
             "between the two records is scoreboard luck: garbage time, "
             "short fields, fluke bounces. Grading always settles on the "
             "scoreboard; this is the honesty check.")
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
    y += 40 * S

    # ---- the two records, side by side ----
    def stat_col(x, lab, record, units):
        dr.text((x, y), lab, font=f_statlab, fill=GOLD_LIGHT)
        dr.text((x, y + 22 * S), record, font=f_stat, fill=CREAM)
        ucol = SAGE if units > 0 else RUST if units < 0 else TEXT_LIGHT
        dr.text((x, y + 84 * S), f"{units:+.1f}u", font=font("georgiab.ttf", 24),
                fill=ucol)
    stat_col(PAD, "ON THE SCOREBOARD", rec(rows, "act"), net_act)
    stat_col(W // 2 + 30 * S, "ON THE PLAYED SCORE", rec(rows, "adj"),
             net_adj)
    ar = "\u2192"
    dr.text((W // 2 - 30 * S, y + 50 * S), ar, font=font("seguisb.ttf", 40),
            fill=GOLD_LIGHT, anchor="ms")
    y += 130 * S
    note = (f"{len(flips)} of {len(rows)} results flip on the played score"
            + (f" \u00b7 {no_adj} picks on games without an adjusted score sit out"
               if no_adj else "")
            + (f" \u00b7 {pending} pick{'s' if pending != 1 else ''} still to play"
               if pending else ""))
    dr.text((PAD, y), note, font=f_rowsub, fill=TEXT_LIGHT)
    y += 34 * S
    dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
    y += 20 * S

    # ---- the flips ----
    dr.text((PAD, y + 12 * S), f"WHERE THE VERDICT CHANGES ({len(flips)})",
            font=f_sect, fill=GOLD_LIGHT, anchor="ls")
    y += 28 * S
    for r in sorted(flips, key=lambda r: (r["kick"] or "", r["matchup"] or "")):
        base = y + 26 * S
        ln = r["line"]
        if ln is not None and str(r["side"]).lower() not in ("over", "under"):
            ls = str(ln).replace("\u2212", "-").lstrip("+")
            try:
                ln = f"+{ls}" if float(ls) > 0 else ls
            except (TypeError, ValueError):
                ln = str(r["line"])
        bet = f"{r['side']} {ln}" if ln is not None else f"{r['side']}"
        dr.text((PAD, base), bet, font=f_row, fill=CREAM, anchor="ls")
        bw = dr.textlength(bet, font=f_row)
        dr.text((PAD + bw + 12 * S, base), MKT.get(r["market"], ""),
                font=f_mkt, fill=GOLD_LIGHT, anchor="ls")
        dr.text((PAD, base + 20 * S),
                f"{r['matchup']} \u00b7 actual {r['act_s']} \u00b7 "
                f"adjusted {r['adj_s']}",
                font=f_rowsub, fill=TEXT_LIGHT, anchor="ls")
        badge(dr, W - PAD - 260 * S, base, r["tier"])
        g1, c1 = GLYPH[r["act"]]
        g2, c2 = GLYPH[r["adj"]]
        gx = W - PAD - 150 * S
        dr.text((gx, base), g1, font=f_glyph, fill=c1, anchor="ls")
        dr.text((gx + 34 * S, base), ar, font=f_row, fill=TEXT_LIGHT,
                anchor="ls")
        dr.text((gx + 64 * S, base), g2, font=f_glyph, fill=c2, anchor="ls")
        sw = r["pnl_adj"] - r["pnl_act"]
        dr.text((W - PAD, base), f"{sw:+.1f}u", font=f_row,
                fill=SAGE if sw > 0 else RUST, anchor="rs")
        y += 62 * S
        dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
        y += 6 * S

    y += 16 * S
    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 26 * S
    dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
            fill=GOLD_LIGHT, anchor="ls")
    dr.text((W - PAD, fy + 22 * S),
            "GRADED ON THE SCOREBOARD \u00b7 RE-SCORED ON THE PLAYED GAME",
            font=f_footnote, fill=TEXT_LIGHT, anchor="rs")
    img.crop((0, 0, W, fy + 52 * S)).save(out, "PNG")
    print(f"wrote {out} | {len(rows)} picks | actual {rec(rows, 'act')} "
          f"{net_act:+.1f}u | adjusted {rec(rows, 'adj')} {net_adj:+.1f}u | "
          f"flips {len(flips)} | no-adj {no_adj} | pending {pending}")


if __name__ == "__main__":
    main()

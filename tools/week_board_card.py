# -*- coding: utf-8 -*-
"""Weekly board card — every pick that RELEASED with a grade, release → now.

    py -X utf8 tools/week_board_card.py [out.png] [start] [end]

One row per released-graded pick (release tier != No Edge). Unchanged
grade → a single line showing the release. Changed grade → release badge
→ current badge plus a one-line WHY built from what actually moved
(line / side / price — the electorate conditions on the live number).
Data: public game breakdowns; defaults to the Week 1 window.
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
RUST = (186, 92, 48)
DIM = (74, 70, 60)
TIER_COL = {"A+": GOLD_LIGHT, "A": GOLD, "B": SILVER, "C": BRONZE,
            "no_edge": DIM}
TIER_LBL = {"A+": "A+", "A": "A", "B": "B", "C": "C", "no_edge": "No Edge"}
MKT = {"spread": "SPREAD", "total": "TOTAL", "moneyline": "ML", "ml": "ML"}
ET = ZoneInfo("America/New_York")

F = "C:/Windows/Fonts"
def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)

f_eyebrow  = font("seguisb.ttf", 17)
f_title    = font("georgiab.ttf", 64)
f_gloss    = font("segoeui.ttf", 16)
f_row      = font("seguisb.ttf", 18)
f_rowsub   = font("segoeui.ttf", 14)
f_badge    = font("seguisb.ttf", 14)
f_mkt      = font("seguisb.ttf", 12)
f_why      = font("segoeui.ttf", 14)
f_sect     = font("seguisb.ttf", 15)
f_footurl  = font("georgiab.ttf", 26)
f_footnote = font("seguisb.ttf", 13)

ANON = "sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE"
API = "https://betbuddy-backend.onrender.com"


def _hist(proj, market, field):
    """Rule/bloc record off the game's own chart payload — only when the
    curve IS the signals' (never the broad line band)."""
    hr = ((proj.get(market) or {}).get("historical_range") or {})
    if hr.get("source") in ("rule", "bloc"):
        return hr.get(field)
    return None


def fetch_rows(start, end):
    req = urllib.request.Request(
        "https://brwalcuodwxsynrpiqjc.supabase.co/rest/v1/games?season=eq.2026"
        f"&start_date=gte.{start}&start_date=lt.{end}"
        "&select=id,home_team,away_team,start_date&order=start_date&limit=200",
        headers={"apikey": ANON})
    games = json.load(urllib.request.urlopen(req, timeout=60))

    def one(g):
        try:
            return g, json.load(urllib.request.urlopen(
                f"{API}/canonical/games/{g['id']}/breakdown", timeout=90))
        except Exception:
            return g, None

    rows, pool = [], []
    with ThreadPoolExecutor(8) as ex:
        for g, d in ex.map(one, games):
            if not d:
                continue
            proj = d.get("projections") or {}
            for p in d.get("picks") or []:
                h = p.get("history") or {}
                rel = h.get("released") or {}
                rt = rel.get("tier") or "no_edge"
                ct = p.get("tier") or "no_edge"
                cur = h.get("current") or {}
                entry = dict(
                    gid=g["id"],
                    matchup=f"{g['away_team']} @ {g['home_team']}",
                    kick=g["start_date"], market=p.get("market"),
                    rt=rt, rs=rel.get("side"), rl=rel.get("line"),
                    rp=rel.get("price"),
                    ct=ct, cs=p.get("side_display"), cl=p.get("line"),
                    cprice=cur.get("price"), voters=p.get("voters"),
                    vlabels=[v.get("label") for v in (p.get("voter_details") or [])
                             if v.get("label")],
                    rbook=((rel.get("book") or {}).get("name")
                           if isinstance(rel.get("book"), dict)
                           else rel.get("book")),
                    rat=rel.get("at"),
                    hist_rate=_hist(proj, p.get("market"), "cover_rate"),
                    hist_n=(_hist(proj, p.get("market"), "sample_size")
                            or _hist(proj, p.get("market"), "signal_count")),
                    trans=h.get("transitions") or [])
                # Sizing pool = everything the allocator stakes RIGHT NOW
                # (currently graded), including picks that released No Edge
                # — they share the pot even if this board doesn't show them.
                if ct != "no_edge":
                    pool.append(entry)
                # Board = graded at EITHER end: released with a grade, or
                # released No Edge and graded since (Austin, 2026-08-30:
                # "show both... more transparent").
                if rt != "no_edge" or ct != "no_edge":
                    rows.append(entry)
    rows.sort(key=lambda r: (r["kick"], r["matchup"], r["market"]))
    return rows, pool


def sizing_prob_dec(r):
    """(p, dec) the allocator PRICES this leg at — the grade-anchored
    number, not the raw pooled record: tier anchor + shrunk bloc tilt for
    spread/total (ladder_leg_probability), (1 + tier ROI-LB)/decimal for
    ML. The raw bloc rate is per-rule fires pooled across ALL its games
    and (for ML) all prices — context, never the staking number."""
    import sys as _sys
    _here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _bb = os.path.join(os.path.dirname(_here), "betbuddy-backend")
    if _bb not in _sys.path:
        _sys.path.insert(0, _bb)
    from pipeline.cell_probabilities import ladder_leg_probability

    def am_to_dec(a):
        try:
            a = float(str(a).replace("−", "-").replace("+", ""))
        except (TypeError, ValueError):
            return None
        if a == 0:
            return None
        return 1 + a / 100 if a > 0 else 1 + 100 / (-a)

    if (r["market"] or "").startswith("m"):
        dec = am_to_dec(r.get("cl"))
        return ((1.08 / dec) if dec else None), dec
    dec = am_to_dec(r.get("cprice") or -110)
    if (r.get("ct") or "no_edge") == "no_edge":
        return None, dec
    return ladder_leg_probability(r["ct"], voters=r.get("voters")), dec


def allocator_units(pool, beta=0.5, gamma=0.5):
    """Stakes in UNITS on the CURRENT sheet, the site's exact math
    (Moderate preset) with one presentation change: the pot is scaled so
    the AVERAGE stake is exactly 1u (pot = number of staked bets).
    Straights: p from ladder_leg_probability(current tier, voters) for
    spread/total, (1.08 / decimal) for ML. Tickets: the sheet's Best and
    Longshot 3-legs (rank p·dec / p·dec², one leg per game), weighted
    with the cash-frequency penalty (× p), same as the page."""
    legs = []
    for r in pool:
        p, dec = sizing_prob_dec(r)
        if not p or not dec or dec <= 1:
            continue
        legs.append((r, p, dec))

    def pick3(ranked):
        out, used = [], set()
        for r, p, dec in ranked:
            if r["gid"] in used:
                continue
            used.add(r["gid"])
            out.append((r, p, dec))
            if len(out) == 3:
                break
        return out

    best3 = pick3(sorted(legs, key=lambda t: -(t[1] * t[2])))
    long3 = pick3(sorted(legs, key=lambda t: -(t[1] * t[2] ** 2)))
    tickets = []
    seen = set()
    for name, t in (("Best 3-leg", best3), ("Longshot 3-leg", long3)):
        sig = tuple(sorted((r["gid"], r["market"]) for r, _, _ in t))
        if len(t) < 3 or sig in seen:
            continue
        seen.add(sig)
        p = dec = 1.0
        for _, lp, ld in t:
            p *= lp
            dec *= ld
        tickets.append(dict(name=name, legs=[r for r, _, _ in t],
                            p=p, dec=dec))

    cand = []
    for r, p, dec in legs:
        edge = p - 1 / dec
        if edge <= 0:
            continue
        w = (edge * p) ** gamma * dec ** beta
        cand.append(dict(key=(r["gid"], r["market"]), w=w))
    for t in tickets:
        edge = t["p"] - 1 / t["dec"]
        if edge <= 0:
            t["stake"] = 0.0
            continue
        t["w"] = (edge * t["p"]) ** gamma * t["p"] * t["dec"] ** beta

    staked_t = [t for t in tickets if t.get("w")]
    tot = sum(c["w"] for c in cand) + sum(t["w"] for t in staked_t)
    pot = float(len(cand) + len(staked_t))   # average stake = 1u exactly
    out = {}
    for c in cand:
        out[c["key"]] = pot * c["w"] / tot if tot > 0 else 0.0
    for t in staked_t:
        t["stake"] = pot * t["w"] / tot if tot > 0 else 0.0
    return out, tickets


def why_line(r):
    """Factual reason the grade moved. Two real mechanisms:
    (1) the market moved — the line/price crossed a rule's band (band
        MEMBERSHIP decides, so a move 'against' the pick can still fire
        rules — e.g. a total dropping to 52 enters the under-52 band);
    (2) the PROJECTIONS moved against the same number — Sunday's data
        update put Week 0 into the model chains, shifting every edge.
    For upgrades, quote the rule(s) actually firing now."""
    bits = []
    rs, cs = r.get("rs") or "", r.get("cs") or ""
    if rs and cs and rs.split()[0] != cs.split()[0]:
        bits.append(f"pick flipped {rs} → {cs}")
    rl, cl = r.get("rl"), r.get("cl")

    def _num(v):
        try:
            return float(str(v).replace("−", "-").replace("+", ""))
        except (TypeError, ValueError):
            return None
    a, b = _num(rl), _num(cl)
    # Numeric compare — "+24.5" vs "24.5" is the SAME number, and calling
    # it a move buried the real reason (the model re-projection).
    moved = (rl is not None and cl is not None
             and ((a is None or b is None) and str(rl) != str(cl)
                  or (a is not None and b is not None and abs(a - b) > 1e-9)))
    is_ml = (r.get("market") or "").startswith("m")
    if moved:
        if (is_ml and a is not None and b is not None
                and (a < 0) != (b < 0)):
            # ML rules anchor to favorite/dog context — the price crossing
            # even money means the MARKET flipped the favorite (the pick
            # side never changed), and fav-conditioned rules (un)fired.
            bits.append(f"the market flipped the favorite ({rl} → {cl}); "
                        f"our side never changed — fav/dog-anchored rules "
                        f"{'now fire' if TIER_ORDER(r['ct']) > TIER_ORDER(r['rt']) else 'unfired'}")
        else:
            word = "price" if is_ml else "line"
            bits.append(f"{word} moved {rl} → {cl}")
    else:
        bits.append("same number — Week 0 stats landed and the "
                    "opponent-adjusted (SoS) solve moved every input")
    for t in reversed(r.get("trans") or []):
        for k in ("anchor_note", "note"):
            if t.get(k):
                bits.append(str(t[k]))
                break
        else:
            continue
        break
    up = TIER_ORDER(r["ct"]) > TIER_ORDER(r["rt"])
    if up and r.get("vlabels"):
        vl = r["vlabels"]
        shown = vl[0] if len(vl[0]) < 70 else vl[0][:67] + "…"
        extra = f" (+{len(vl) - 1} more)" if len(vl) > 1 else ""
        bits.append(f"now firing: {shown}{extra}")
    if not up:
        bits.append("the released vote no longer clears")
    verb = "regraded up" if up else "regraded down"
    return f"{verb}: " + "; ".join(bits)


def TIER_ORDER(t):
    return {"no_edge": 0, "C": 1, "B": 2, "A": 3, "A+": 4}.get(t, 0)


def badge(dr, x, base, tier):
    """The site's .ll-badge, faithfully: 36x32 filled chip, radius 2.
    A gold/cream · B silver/ink · C bronze/cream · A+ ink chip with gold
    border and gold-light letter · No Edge transparent with dim border."""
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
    out = sys.argv[1] if len(sys.argv) > 1 else "week_board.png"
    start = sys.argv[2] if len(sys.argv) > 2 else "2026-09-01"
    end = sys.argv[3] if len(sys.argv) > 3 else "2026-09-09"
    rows, pool = fetch_rows(start, end)
    stakes, tickets = allocator_units(pool)
    changed = [r for r in rows if r["ct"] != r["rt"]]
    same = [r for r in rows if r["ct"] == r["rt"]]

    img = Image.new("RGB", (W, 4200 * S), INK)
    dr = ImageDraw.Draw(img)
    y = 44 * S
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    if os.path.exists(lp):
        lg = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        lg = lg.resize((int(lg.width * h_ / lg.height), h_), Image.LANCZOS)
        img.paste(lg, (PAD, y), lg)
    dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL · 2026", font=f_sect,
            fill=TEXT_LIGHT, anchor="rs")
    y += 96 * S + 22 * S

    dr.text((PAD, y), "WEEK 1 · EVERY GRADED RELEASE, TRACKED", font=f_eyebrow,
            fill=GOLD_LIGHT)
    y += 30 * S
    # Georgia Bold has no → glyph (tofu) — compose the arrow from Segoe.
    t1, t2 = "Release ", " Now"
    f_arrow = font("seguisb.ttf", 52)
    x = PAD
    dr.text((x, y), t1, font=f_title, fill=CREAM)
    x += dr.textlength(t1, font=f_title)
    dr.text((x, y + 14 * S), "→", font=f_arrow, fill=GOLD_LIGHT)
    x += dr.textlength("→", font=f_arrow)
    dr.text((x, y), t2, font=f_title, fill=CREAM)
    y += 86 * S
    gloss = (f"All {len(rows)} picks graded at either end — released with a "
             "grade, or released No Edge and graded since. One line = held "
             "as released. Two badges = the grade moved with the market, "
             "and the line under it says exactly why. Units are the "
             "allocator's CURRENT sheet (Moderate), scaled so the average "
             "bet is one unit — tickets included. Grading always settles "
             "on the release.")
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

    def day_lbl(k):
        d = datetime.fromisoformat(k.replace("Z", "+00:00")).astimezone(ET)
        return d.strftime("%a %-m/%-d") if os.name != "nt" else d.strftime("%a %#m/%#d")

    def draw_rows(rows_, with_why):
        nonlocal y
        for r in rows_:
            base = y + 26 * S
            rl = r["rl"]
            if (r["market"] or "").startswith("m") and rl is not None:
                try:
                    if float(str(rl).replace("−", "-")) > 0:
                        rl = f"+{rl}"
                except (TypeError, ValueError):
                    pass
            bet = f"{r['rs']} {rl}" if rl is not None else f"{r['rs']}"
            px = f" ({r['rp']})" if r.get("rp") else ""
            dr.text((PAD, base), bet + px, font=f_row, fill=CREAM, anchor="ls")
            bw = dr.textlength(bet + px, font=f_row)
            dr.text((PAD + bw + 12 * S, base), MKT.get(r["market"], ""),
                    font=f_mkt, fill=GOLD_LIGHT, anchor="ls")
            dr.text((PAD, base + 20 * S),
                    f"{r['matchup']} · {day_lbl(r['kick'])}",
                    font=f_rowsub, fill=TEXT_LIGHT, anchor="ls")
            st = stakes.get((r["gid"], r["market"]))
            st_txt = f"{st:.1f}u" if st else "—"
            dr.text((W - PAD, base), st_txt, font=f_row,
                    fill=GOLD_LIGHT if st else DIM, anchor="rs")
            bx = W - PAD - 260 * S
            bwidth = badge(dr, bx, base, r["rt"])
            if with_why:
                ax = bx + bwidth + 10 * S
                dr.text((ax, base), "→", font=f_row, fill=TEXT_LIGHT, anchor="ls")
                badge(dr, ax + dr.textlength("→", font=f_row) + 10 * S,
                      base, r["ct"])
                # WRAP the why — a long reason sailed off the right edge
                # when drawn as one line (Austin, 2026-08-30).
                wy = base + 42 * S
                words, line_ = why_line(r).split(), ""
                lines = []
                for w_ in words:
                    t_ = (line_ + " " + w_).strip()
                    if dr.textlength(t_, font=f_why) <= W - 2 * PAD - 28 * S:
                        line_ = t_
                    else:
                        lines.append(line_)
                        line_ = w_
                if line_:
                    lines.append(line_)
                for ln in lines[:3]:
                    dr.text((PAD + 14 * S, wy), ln, font=f_why,
                            fill=GOLD_LIGHT, anchor="ls")
                    wy += 20 * S
                y += 64 * S + 20 * S * min(len(lines), 3)
            else:
                y += 62 * S
            dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
            y += 6 * S

    if changed:
        dr.text((PAD, y + 12 * S), f"GRADE MOVED ({len(changed)})",
                font=f_sect, fill=GOLD_LIGHT, anchor="ls")
        y += 26 * S
        draw_rows(changed, with_why=True)
        y += 16 * S
    dr.text((PAD, y + 12 * S),
            f"HOLDING AS RELEASED ({len(same)})", font=f_sect,
            fill=GOLD_LIGHT, anchor="ls")
    y += 26 * S
    draw_rows(same, with_why=False)

    if tickets:
        y += 18 * S
        dr.text((PAD, y + 12 * S), "THE PARLAYS ON THE SHEET",
                font=f_sect, fill=GOLD_LIGHT, anchor="ls")
        y += 30 * S
        for t in tickets:
            base = y + 26 * S
            dr.text((PAD, base), t["name"], font=f_row, fill=CREAM,
                    anchor="ls")
            nw = dr.textlength(t["name"], font=f_row)
            dr.text((PAD + nw + 12 * S, base),
                    f"+{(t['dec'] - 1) * 100:.0f}", font=f_row,
                    fill=GOLD, anchor="ls")

            def leg_txt(r):
                cl = r["cl"]
                is_total = (r.get("cs") or "").split(" ")[0] in ("Over", "Under")
                if cl is not None and not is_total:
                    try:
                        if float(str(cl).replace("−", "-")) > 0:
                            cl = f"+{cl}"
                    except (TypeError, ValueError):
                        pass
                bet = f"{r['cs']} {cl}" if cl is not None else f"{r['cs']}"
                if is_total:
                    home = r["matchup"].split(" @ ")[-1]
                    return f"{bet} ({home})"
                return bet
            dr.text((PAD, base + 20 * S),
                    "  ·  ".join(leg_txt(r) for r in t["legs"]),
                    font=f_rowsub, fill=TEXT_LIGHT, anchor="ls")
            st = t.get("stake") or 0.0
            dr.text((W - PAD, base), f"{st:.1f}u" if st else "—",
                    font=f_row, fill=GOLD_LIGHT if st else DIM, anchor="rs")
            y += 62 * S
            dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
            y += 6 * S

    y += 20 * S
    dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
    fy = y + 26 * S
    dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
            fill=GOLD_LIGHT, anchor="ls")
    dr.text((W - PAD, fy + 22 * S),
            "GRADED ON THE RELEASED LINE · REGRADES ON THE RECORD",
            font=f_footnote, fill=TEXT_LIGHT, anchor="rs")
    img.crop((0, 0, W, fy + 52 * S)).save(out, "PNG")
    print(f"wrote {out} | rows {len(rows)} | changed {len(changed)}")


if __name__ == "__main__":
    main()

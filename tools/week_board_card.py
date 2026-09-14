# -*- coding: utf-8 -*-
"""Weekly board card — every pick that RELEASED with a grade, AS RELEASED.

    py -X utf8 tools/week_board_card.py [out.png] [start] [end] [week_lbl]

One row per released-graded pick (release tier != No Edge): side, line,
juice, and grade exactly as they hit the board — the record (Austin 9/7:
"just show released"). The ONLY annotation is a rust INVALIDATED note on
picks the market has since taken away: an ADVERSE move (mirroring
allocator.html relMove/invalidatedAdversely verbatim — line toward our
number, over-number up, ML lengthened or favorite flipped) AND the
current grade is No Edge. Favorable moves never flag. Units = released
sheet (released tiers + released prices), average one unit per pick.
Data: public game breakdowns; defaults to the Week 1 window.

PAGINATED (Austin 9/7: "that's so tall — break it up into a few cards"):
rows flow across as many cards as needed (~4000px cap each); card 1
carries the full header, later cards a slim continuation header, every
card the footer. One page fits → the plain out name; else _NofM names.
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
                    rp=rel.get("price"), rprob=rel.get("our_prob"),
                    ct=ct, cs=p.get("side_display"), cl=p.get("line"),
                    cprice=cur.get("price"), voters=p.get("voters"),
                    rbook=((rel.get("book") or {}).get("name")
                           if isinstance(rel.get("book"), dict)
                           else rel.get("book")),
                    rat=rel.get("at"),
                    hist_rate=_hist(proj, p.get("market"), "cover_rate"),
                    hist_n=(_hist(proj, p.get("market"), "sample_size")
                            or _hist(proj, p.get("market"), "signal_count")))
                # Board AND sizing pool = the RELEASE of record: every pick
                # that released with a grade, nothing else. The pot is the
                # released sheet (released tiers at released prices).
                if rt != "no_edge":
                    rows.append(entry)
                    pool.append(entry)
    rows.sort(key=lambda r: (r["kick"], r["matchup"], r["market"]))
    return rows, pool


def sizing_prob_dec(r):
    """(p, dec) the RELEASED sheet prices this leg at — the release is the
    record (Austin 9/7), so p comes from the RELEASED tier (the shipped
    released our_prob when the payload carries it, else the tier anchor
    via ladder_leg_probability) and dec from the RELEASED price."""
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
        dec = am_to_dec(r.get("rl"))          # ML: the released price
        return ((1.08 / dec) if dec else None), dec
    dec = am_to_dec(r.get("rp") or -110)      # released juice
    if (r.get("rt") or "no_edge") == "no_edge":
        return None, dec
    if r.get("rprob"):
        return float(r["rprob"]), dec
    return ladder_leg_probability(r["rt"], voters=r.get("voters")), dec


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


def _num(v):
    try:
        return float(str(v).replace("−", "-").replace("+", ""))
    except (TypeError, ValueError):
        return None


def _side_key(s):
    """Team display name as-is; totals collapse to their over/under word."""
    s = str(s or "").strip()
    tok = s.split()[0].lower() if s.split() else ""
    return tok if tok in ("over", "under") else s.lower()


def rel_move(r):
    """Mirror of allocator.html relMove — movement from the RELEASED
    side's point of view. Adverse = the market took the number: picked-
    side spread lower, under-number lower / over-number higher, ML price
    lengthened, or the favorite flipped. Favorable is never adverse."""
    same = (_side_key(r.get("rs")) == _side_key(r.get("cs"))
            if (r.get("rs") and r.get("cs")) else True)
    is_ml = (r.get("market") or "").startswith("m")

    def dec(x):
        return 1 + x / 100 if x > 0 else 1 + 100 / (-x)

    if is_ml:
        if not same:
            return dict(moved=True, adverse=True, bare=True,
                        txt="the market flipped the favorite")
        a, b = _num(r.get("rl")), _num(r.get("cl"))
        if a is None or b is None or a == b:
            return dict(moved=False)
        return dict(moved=True, adverse=dec(b) > dec(a),
                    txt=f"{a:+g} → {b:+g}")
    cur, rel = _num(r.get("cl")), _num(r.get("rl"))
    if cur is None or rel is None:
        return dict(moved=False)
    if not same and r.get("market") == "spread":
        cur = -cur                      # released side's own number
    if cur == rel:
        return dict(moved=False)
    if r.get("market") == "total":
        under = _side_key(r.get("rs")) == "under"
        adverse = cur < rel if under else cur > rel
        return dict(moved=True, adverse=adverse, txt=f"{rel:g} → {cur:g}")
    return dict(moved=True, adverse=cur < rel, txt=f"{rel:+g} → {cur:+g}")


def invalidated(r):
    """allocator.html invalidatedAdversely, verbatim: current grade is
    No Edge AND the move was adverse. Returns the flag text, else None."""
    if (r.get("ct") or "no_edge") != "no_edge":
        return None
    mv = rel_move(r)
    if not (mv and mv.get("moved") and mv.get("adverse")):
        return None
    if mv.get("bare"):
        return "INVALIDATED — the market flipped the favorite · now No Edge"
    return (f"INVALIDATED — the market took the number: {mv['txt']} · "
            "now No Edge")


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
    week_lbl = sys.argv[4] if len(sys.argv) > 4 else "WEEK 1"
    rows, pool = fetch_rows(start, end)
    # Tickets stay in the pot (the released sheet stakes them) but are not
    # rendered — their cross-book price is no real ticket, and the site's
    # allocator is where the covering-book parlays live.
    stakes, _tickets = allocator_units(pool)
    n_inv = sum(1 for r in rows if invalidated(r))
    # Biggest allocation first (Austin 9/7); unstaked rows sink, then kick.
    rows.sort(key=lambda r: (-(stakes.get((r["gid"], r["market"])) or 0.0),
                             r["kick"], r["matchup"], r["market"]))

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, "pressbox-w2a-ink-cropped.png")
    logo = None
    if os.path.exists(lp):
        logo = Image.open(lp).convert("RGBA")
        h_ = 96 * S
        logo = logo.resize((int(logo.width * h_ / logo.height), h_),
                           Image.LANCZOS)

    meas = ImageDraw.Draw(Image.new("RGB", (8, 8)))

    def wrap(text, fnt, maxw):
        words, line_, lines = text.split(), "", []
        for w_ in words:
            t_ = (line_ + " " + w_).strip()
            if meas.textlength(t_, font=fnt) <= maxw:
                line_ = t_
            else:
                lines.append(line_)
                line_ = w_
        if line_:
            lines.append(line_)
        return lines

    def day_lbl(k):
        d = datetime.fromisoformat(k.replace("Z", "+00:00")).astimezone(ET)
        return d.strftime("%a %-m/%-d") if os.name != "nt" else d.strftime("%a %#m/%#d")

    inv_bit = (
        f"{n_inv} {'carries' if n_inv == 1 else 'carry'} an INVALIDATED "
        "flag — the market has since taken the number, moving far enough "
        "toward our side that the grade no longer holds today."
        if n_inv else
        "None have been invalidated — a flag appears only when the market "
        "takes the number out from under a grade.")
    gloss = (f"All {len(rows)} picks that released with a grade — side, "
             "line, juice, and grade exactly as they hit the board. The "
             f"release is the record, and grading settles there. {inv_bit} "
             "A favorable move never invalidates: the grade stands at a "
             "better entry. Units are the released sheet, scaled so the "
             "average bet is one unit.")
    gloss_lines = wrap(gloss, f_gloss, W - 2 * PAD)

    HEAD_FULL = (278 + len(gloss_lines) * 23 + 9 + 32) * S
    HEAD_SLIM = 224 * S
    FOOT = 98 * S
    CAP = 2050 * S          # ~4100px per card (Austin 9/7: not so tall)

    # ---- measured item list ----
    items = []

    def add_sect(lbl):
        items.append(dict(kind="sect", lbl=lbl, h=44 * S))

    def add_picks(rs):
        for r in rs:
            note = invalidated(r)
            why = (wrap(note, f_why, W - 2 * PAD - 28 * S)[:3]
                   if note else None)
            h = (70 * S + 20 * S * len(why)) if why else 68 * S
            items.append(dict(kind="pick", r=r, why=why, h=h))

    add_sect(f"EVERY GRADED RELEASE ({len(rows)})"
             + (f" · {n_inv} INVALIDATED" if n_inv else ""))
    add_picks(rows)

    # ---- paginate: never break right after a section label ----
    pages, cur, sect_lbl = [], [], None
    rem = CAP - HEAD_FULL - FOOT
    i = 0
    while i < len(items):
        it = items[i]
        need = it["h"]
        if it["kind"] == "sect" and i + 1 < len(items):
            need += items[i + 1]["h"]
        # Widow rule: a one-or-two-row tail is not a card. If everything
        # left fits with a little slack, stretch this page instead.
        tail = sum(x["h"] for x in items[i:])
        if need > rem and cur and tail > rem + 150 * S:
            pages.append(cur)
            cur = []
            rem = CAP - HEAD_SLIM - FOOT
            if sect_lbl and it["kind"] != "sect":
                cont = dict(kind="sect", lbl=f"{sect_lbl} · CONT.", h=44 * S)
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

    # ---- draw helpers ----
    def draw_pick(dr, it, y):
        r = it["r"]
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
        badge(dr, W - PAD - 260 * S, base, r["rt"])
        if it["why"] is not None:
            wy = base + 42 * S
            for ln in it["why"]:
                dr.text((PAD + 14 * S, wy), ln, font=f_why,
                        fill=RUST, anchor="ls")
                wy += 20 * S
            y += 64 * S + 20 * S * len(it["why"])
        else:
            y += 62 * S
        dr.line([PAD, y, W - PAD, y], fill=DIVIDER, width=1 * S)
        y += 6 * S
        return y

    # ---- render pages ----
    stem = out[:-4] if out.lower().endswith(".png") else out
    outs = []
    for pi, page in enumerate(pages, 1):
        content_h = sum(it["h"] for it in page)
        head = HEAD_FULL if pi == 1 else HEAD_SLIM
        img = Image.new("RGB", (W, head + content_h + FOOT + 60 * S), INK)
        dr = ImageDraw.Draw(img)
        y = 44 * S
        if logo:
            img.paste(logo, (PAD, y), logo)
        dr.text((W - PAD, y + 70 * S), "COLLEGE FOOTBALL · 2026",
                font=f_sect, fill=TEXT_LIGHT, anchor="rs")
        y += 96 * S + 22 * S
        eyebrow = f"{week_lbl} · THE BOARD, AS RELEASED"
        if N > 1:
            eyebrow += f" · {pi} OF {N}"
        dr.text((PAD, y), eyebrow, font=f_eyebrow, fill=GOLD_LIGHT)
        y += 30 * S
        if pi == 1:
            dr.text((PAD, y), "The released board.", font=f_title,
                    fill=CREAM)
            y += 86 * S
            for ln in gloss_lines:
                dr.text((PAD, y), ln, font=f_gloss, fill=TEXT_LIGHT)
                y += 23 * S
            y += 9 * S
        dr.rectangle([PAD, y, W - PAD, y + 4 * S], fill=GOLD)
        y += 28 * S

        for it in page:
            if it["kind"] == "sect":
                dr.text((PAD, y + 28 * S), it["lbl"], font=f_sect,
                        fill=GOLD_LIGHT, anchor="ls")
                y += it["h"]
            else:
                y = draw_pick(dr, it, y)

        y += 20 * S
        dr.rectangle([0, y, W, y + 4 * S], fill=GOLD)
        fy = y + 26 * S
        dr.text((PAD, fy + 24 * S), "pressboxanalytics.com", font=f_footurl,
                fill=GOLD_LIGHT, anchor="ls")
        dr.text((W - PAD, fy + 22 * S),
                "GRADED ON THE RELEASED LINE · ADVERSE MOVES FLAGGED",
                font=f_footnote, fill=TEXT_LIGHT, anchor="rs")
        name = out if N == 1 else f"{stem}_{pi}of{N}.png"
        img.crop((0, 0, W, fy + 52 * S)).save(name, "PNG")
        outs.append(name)
    print(f"wrote {' + '.join(outs)} | released {len(rows)} | "
          f"invalidated {n_inv} | pages {N}")


if __name__ == "__main__":
    main()

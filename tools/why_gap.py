"""
tools/why_gap.py — why do our models read this game differently than Vegas?

Per-game decomposition for analysis posts. Pure read-side: pulls the public
breakdown payload, no keys, no writes.

Usage:
  py tools/why_gap.py 401856776 401858424        # specific games
  py tools/why_gap.py --week 1                   # every week-1 game with a 3+ pt gap

Output per game:
  - the spread gap and the total gap (blend vs market)
  - which models drive it: consensus / split / one-model outlier
  - the spread-total pairing archetype (what kind of disagreement this is)
  - DNA axes worth quoting (pace, efficiency, explosiveness, talent)
  - fired signals, if any
  - the honesty line whenever the gap is big or an FCS side is involved
"""
import json
import sys
import urllib.request

API = "https://betbuddy-backend.onrender.com"
SUPA = "https://brwalcuodwxsynrpiqjc.supabase.co/rest/v1"
# anon publishable key — public by design, used client-side sitewide
SUPA_KEY = "sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE"

MODELS = ("SP+", "PPA", "Advanced", "Pace+")   # the four that vote; Elo display-only


def fetch(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    return json.load(urllib.request.urlopen(req, timeout=90))


def week_game_ids(week):
    hdr = {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"}
    rows = fetch(f"{SUPA}/games?season=eq.2026&week=eq.{week}"
                 f"&select=id&order=start_date.asc&limit=100", hdr)
    return [r["id"] for r in rows]


def analyze(game_id):
    d = fetch(f"{API}/canonical/games/{game_id}/breakdown")
    g = d.get("game") or {}
    home, away = (g.get("home") or {}).get("name", "Home"), (g.get("away") or {}).get("name", "Away")
    proj = d.get("projections") or {}
    sp, tot = proj.get("spread") or {}, proj.get("total") or {}

    vegas_sp = sp.get("vegas_anchor_spread")
    anchor_home = bool((proj.get("anchor") or sp.get("anchor") or {}).get("is_home", True))
    blend_sp = sp.get("pressbox_blend")
    vegas_tot, blend_tot = tot.get("vegas_line"), tot.get("pressbox_blend")
    if vegas_sp is None or blend_sp is None:
        return None

    # Anchor frame: negative = anchor (favorite) lays points. gap > 0 means
    # our blend likes the DOG side of the market number; < 0 likes the fav.
    sp_gap = round(float(vegas_sp) - float(blend_sp), 1) * -1
    fav = home if anchor_home else away
    dog = away if anchor_home else home

    # Per-model margins in the same anchor frame
    model_gaps = {}
    for m in sp.get("models") or []:
        if m.get("name") in MODELS and m.get("anchor_spread") is not None:
            model_gaps[m["name"]] = round(float(vegas_sp) - float(m["anchor_spread"]), 1) * -1
    n_dog = sum(1 for v in model_gaps.values() if v > 0)
    n_fav = sum(1 for v in model_gaps.values() if v < 0)
    if model_gaps:
        vals = sorted(model_gaps.values(), key=abs, reverse=True)
        outlier = (len(vals) >= 2 and abs(vals[0]) > 6
                   and abs(vals[0]) > 2.2 * max(abs(vals[1]), 0.1))
    else:
        outlier = False
    if outlier:
        driver = "one model drags the blend ({})".format(
            max(model_gaps, key=lambda k: abs(model_gaps[k])))
    elif n_dog == len(model_gaps) or n_fav == len(model_gaps):
        driver = "all {} voting models on the same side of the number".format(len(model_gaps))
    else:
        driver = f"models split {n_dog}-{n_fav} around the number"

    tot_gap = (round(float(blend_tot) - float(vegas_tot), 1)
               if (vegas_tot is not None and blend_tot is not None) else None)

    # Archetype: what KIND of disagreement is this?
    arche = None
    if abs(sp_gap) >= 3 and tot_gap is not None:
        likes_dog = sp_gap > 0
        if likes_dog and tot_gap >= 3:
            arche = f"we think {dog}'s offense is real — closer game, more points"
        elif likes_dog and tot_gap <= -3:
            arche = f"we think {fav} is overpriced in a low-event game"
        elif not likes_dog and tot_gap >= 3:
            arche = f"we think {fav} runs away AND the game scores — blowout with points"
        elif not likes_dog and tot_gap <= -3:
            arche = f"we think {fav} controls a short game — margin without fireworks"
        else:
            arche = (f"margin read, not a scoring read — we differ on the spread, "
                     f"agree on the total")
    elif tot_gap is not None and abs(tot_gap) >= 4:
        arche = "pure totals disagreement — we agree on the margin"

    dna = d.get("dna") or {}
    dna_bits = []
    for k in ("talent", "efficiency", "explosiveness", "trenches", "pace", "home_field"):
        v = dna.get(k) or {}
        lbl = v.get("label")
        if lbl and lbl not in ("even",):
            side = v.get("side")
            who = home if side == "home" else away if side == "away" else ""
            dna_bits.append(f"{k}: {who + ' ' if who else ''}{lbl}".strip())

    fired = []
    for p in d.get("picks") or []:
        if p.get("tier") and p.get("tier") != "no_edge":
            fired.append(f"{p['market']} {p['tier']}")

    # ── Fundamentals: WHAT creates this gap ─────────────────────────
    # SP+ carries Connelly's preseason priors (returning production,
    # recruiting) early season — it is semi-EXPECTATION-aware. PPA /
    # Advanced / Pace+ are pure trailing performance. The split between
    # them measures the roster-expectations story directly.
    fundamentals = []
    spg = model_gaps.get("SP+")
    rest = [v for k, v in model_gaps.items() if k != "SP+"]
    if spg is not None and rest:
        rest_mean = sum(rest) / len(rest)
        expect_delta = round(rest_mean - spg, 1)
        if abs(expect_delta) >= 5:
            side = dog if expect_delta > 0 else fav
            fundamentals.append(
                f"expectations gap {expect_delta:+.1f}: prior-aware SP+ sits at "
                f"{spg:+.1f} vs the number and the pure-performance trio goes "
                f"{expect_delta:+.1f} further toward {side} — the difference "
                f"between pricing the offseason and pricing last year's product")
        elif abs(sp_gap) >= 4 and abs(spg - rest_mean) < 3:
            fundamentals.append(
                "prior-aware SP+ sits WITH the pure-performance models here — "
                "this gap is not an offseason-blindness artifact; the numbers "
                "rate the matchup differently than the market on the merits")
    pg = model_gaps.get("Pace+")
    if pg is not None and rest and len(model_gaps) >= 3:
        others = [v for k, v in model_gaps.items() if k != "Pace+"]
        om = sum(others) / len(others)
        if abs(pg - om) >= 6:
            fundamentals.append(
                f"Pace+ stands {pg - om:+.1f} apart from the other models — "
                f"a tempo story: how fast this game is played changes its "
                f"read more than anyone else's")
    ppa_g = model_gaps.get("PPA")
    if ppa_g is not None and len(model_gaps) >= 3:
        others = [v for k, v in model_gaps.items() if k != "PPA"]
        om = sum(others) / len(others)
        if abs(ppa_g - om) >= 6:
            fundamentals.append(
                f"PPA stands {ppa_g - om:+.1f} apart — an efficiency-per-play "
                f"story, sometimes turnover-luck or garbage-time residue in "
                f"the EPA data")

    # ── Model-vs-model: why the four disagree with EACH OTHER ───────
    # Independent of the market. Who stands apart maps to what they
    # measure: Pace+ = tempo-normalized scoring, PPA = per-play EPA,
    # Advanced = down-to-down success + chunk plays, SP+ = smoothed
    # composite with preseason priors.
    dispersion = {}
    if len(model_gaps) >= 3:
        span = round(max(model_gaps.values()) - min(model_gaps.values()), 1)
        dispersion["span"] = span
        dispersion["verdict"] = ("rare agreement — high conviction read" if span <= 4
                                 else "normal disagreement" if span <= 10
                                 else "the models genuinely can't agree on this one")
        notes = []
        pace_sig = abs((dna.get("pace") or {}).get("sigma") or 0)
        if pg is not None:
            others_p = [v for k, v in model_gaps.items() if k != "Pace+"]
            if others_p and abs(pg - sum(others_p) / len(others_p)) >= 6 and pace_sig >= 0.5:
                notes.append(
                    f"tempo distortion: this projects {'fast' if (dna.get('pace') or {}).get('sigma', 0) > 0 else 'slow'} "
                    f"(pace σ {(dna.get('pace') or {}).get('sigma')}), and Pace+ is the only "
                    f"model that normalizes for it — raw stats flatter "
                    f"{'up-tempo' if (dna.get('pace') or {}).get('sigma', 0) > 0 else 'grinding'} teams")
        adv_g, ppa2 = model_gaps.get("Advanced"), model_gaps.get("PPA")
        if adv_g is not None and ppa2 is not None and abs(adv_g - ppa2) >= 6:
            ex, ef = dna.get("explosiveness") or {}, dna.get("efficiency") or {}
            prof = ""
            if (ex.get("label") not in (None, "even")) != (ef.get("label") not in (None, "even")):
                prof = (" — fits the boom-bust profile here: the explosiveness and "
                        "efficiency edges don't point the same way")
            notes.append(
                f"PPA vs Advanced split {adv_g - ppa2:+.1f}: Advanced pays "
                f"down-to-down consistency, PPA pays the chunk plays{prof}")
        dispersion["notes"] = notes

    caveats = []
    if abs(sp_gap) >= 10:
        caveats.append("gap this size usually means the market knows something the "
                       "prior-year data can't: transfers, injuries, coaching change")
    fbs_conf = {g.get("home", {}).get("conference"), g.get("away", {}).get("conference")}
    if None in fbs_conf or "" in fbs_conf:
        caveats.append("an FCS side is involved — our models barely have film on them")

    return {
        "game": f"{away} @ {home}",
        "market": f"{fav} {vegas_sp}",
        "blend": f"{fav} {round(float(blend_sp), 1)}",
        "spread_gap": sp_gap,
        "gap_side": dog if sp_gap > 0 else fav,
        "driver": driver,
        "model_gaps": model_gaps,
        "total": (f"market {vegas_tot} / blend {round(float(blend_tot), 1)}"
                  if tot_gap is not None else "n/a"),
        "total_gap": tot_gap,
        "archetype": arche,
        "dispersion": dispersion,
        "fundamentals": fundamentals,
        "dna": dna_bits,
        "fired": fired or ["nothing — No Edge"],
        "caveats": caveats,
    }


def render(a):
    lines = [f"== {a['game']}",
             f"   market {a['market']}  |  blend {a['blend']}  |  gap {a['spread_gap']:+.1f} toward {a['gap_side']}",
             f"   driver: {a['driver']}",
             f"   per-model gaps vs the number: " + ", ".join(
                 f"{k} {v:+.1f}" for k, v in a["model_gaps"].items()),
             f"   total: {a['total']}" + (f"  (gap {a['total_gap']:+.1f})" if a['total_gap'] is not None else "")]
    if a["archetype"]:
        lines.append(f"   read: {a['archetype']}")
    disp = a.get("dispersion") or {}
    if disp:
        lines.append(f"   model spread: {disp['span']} pts — {disp['verdict']}")
        for n in disp.get("notes") or []:
            lines.append(f"   inter-model: {n}")
    for f in a.get("fundamentals") or []:
        lines.append(f"   why: {f}")
    if a["dna"]:
        lines.append(f"   dna: " + "; ".join(a["dna"]))
    lines.append(f"   signals: " + ", ".join(a["fired"]))
    for c in a["caveats"]:
        lines.append(f"   caveat: {c}")
    return "\n".join(lines)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--week":
        ids = week_game_ids(int(args[1]))
        min_gap = 3.0
    else:
        ids = [int(a) for a in args]
        min_gap = 0.0
    shown = 0
    for gid in ids:
        try:
            a = analyze(gid)
        except Exception as e:
            print(f"== {gid}: error {e}")
            continue
        if not a:
            continue
        if abs(a["spread_gap"]) >= min_gap or (a["total_gap"] or 0) >= min_gap or a["fired"] != ["nothing — No Edge"]:
            print(render(a))
            print()
            shown += 1
    print(f"({shown} games shown)")

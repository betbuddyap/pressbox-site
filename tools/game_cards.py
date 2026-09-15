# -*- coding: utf-8 -*-
"""Per-game cards (projection + game flow) for any slate, on the LIVE engine.

    py -X utf8 tools/game_cards.py SEASON WEEK GAME_ID[:tz] [GAME_ID[:tz] ...]
      e.g. py -X utf8 tools/game_cards.py 2026 3 401856688:America/Chicago 401862710

    tz = the VENUE's zone for the kickoff label (default America/New_York).
    Output PNGs and the two JSON dumps land in CARD_OUT (default: cwd).

For each game: one simulation run (mk_dump2's method -- home field inside
the sim as a calibrated rating bump, so integer margins carry it -- and
mk_flow's trace, combined) -> {slug}_box.json + {slug}_flow.json -> the two
card scripts in pressbox-site/tools.

Inputs are production's: the week-3 unit ratings from engine_team_ratings
(model_version wf-ridge225...), coaches resolved the way the run resolves
them, HFA_POINTS from engine_week, the market margin from the live page.
"""
import json, os, re, sys, subprocess, time, urllib.request, urllib.parse
import statistics as S
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

ENG = r'C:\Users\AustinPark\Documents\GitHub\betbuddy-backend\engine'
SITE = r'C:\Users\AustinPark\Documents\GitHub\pressbox-site'
SP = os.environ.get("CARD_OUT", os.getcwd())
sys.path.insert(0, ENG)
import sim_engine2 as E            # noqa: E402
import engine_week as W            # noqa: E402

E.TRACE = None
NSIM = int(os.environ.get("CARD_NSIM", "20000"))
NCAL = 4000
KEYS = ("off_rush", "off_pass", "def_rush", "def_pass")
K = 'sb_publishable_yUSCp6-m1gda0eMcGWuinw_LMLGP_uE'
API = 'https://betbuddy-backend.onrender.com'

if len(sys.argv) < 4:
    sys.exit(__doc__)
SEASON, WEEK = int(sys.argv[1]), int(sys.argv[2])
GAMES = []
for a in sys.argv[3:]:
    gid, _, tz = a.partition(":")
    GAMES.append((int(gid), None, tz or "America/New_York"))


def sb(q):
    req = urllib.request.Request('https://brwalcuodwxsynrpiqjc.supabase.co/rest/v1/' + q,
                                 headers={'apikey': K, 'Authorization': 'Bearer ' + K})
    return json.load(urllib.request.urlopen(req, timeout=60))


hc = W._hc_map(SEASON, log=print)
rows = sb('engine_team_ratings?select=team,off_rush,off_pass,def_rush,def_pass,model_version'
          f'&season=eq.{SEASON}&week=eq.{WEEK}&limit=400')
assert rows, f"no engine_team_ratings for {SEASON} week {WEEK}"
assert all(r['model_version'] == W.MODEL_VERSION for r in rows), f"ratings are {rows[0]['model_version']}, engine is {W.MODEL_VERSION}"
R = {r['team']: {k: float(r[k]) for k in KEYS} for r in rows}
HFA = W.HFA_POINTS
print(f"ratings: {len(R)} teams ({rows[0]['model_version']}); HFA {HFA:+.4f}; NSIM {NSIM:,}")

STATES = ("trailing 9+", "trailing 1-8", "tied", "leading 1-8", "leading 9+")


def state_of(diff):
    if diff <= -9: return "trailing 9+"
    if diff < 0: return "trailing 1-8"
    if diff == 0: return "tied"
    if diff <= 8: return "leading 1-8"
    return "leading 9+"


def with_hfa(rating, delta):
    r = dict(rating)
    for k in KEYS:
        r[k] = r.get(k, 0.0) + delta / 2.0
    return r


def run(home, away, ch, ca, n, delta, seed, trace=False):
    E.seed(seed)
    hr = with_hfa(R[home], delta)
    mar, tot, hs, as_, ot = [], [], [], [], 0
    box = defaultdict(lambda: defaultdict(list))
    fl = None
    if trace:
        fl = dict(ribbon=np.zeros((n, 61), dtype=np.int16), lead=np.zeros((n, 61), dtype=np.int8),
                  calls={t: {s: [0, 0] for s in STATES} for t in (home, away)},
                  half={t: {1: [0, 0], 2: [0, 0]} for t in (home, away)},
                  lead_taken=[], never_trailed=0, biggest=[], script=0)
        E.TRACE = []
    for i in range(n):
        if trace:
            E.TRACE.clear()
        sc, st = E.simulate_game(coaches=(ch, ca), ratings=(hr, R[away]))
        hs.append(sc[0]); as_.append(sc[1])
        m = sc[0] - sc[1]
        mar.append(m); tot.append(sc[0] + sc[1])
        ot += 1 if st.get("overtime") else 0
        b = st.get("_box")
        if b:
            for idx, side in ((0, home), (1, away)):
                for k, v in b[idx].items():
                    box[side][k].append(v)
        if trace:
            tr = E.TRACE
            j, cur = 0, 0
            for bn in range(61):
                t = bn * 60.0
                while j < len(tr) and ((tr[j][0] - 1) * 900 + (900 - tr[j][1])) <= t:
                    cur = tr[j][4]
                    j += 1
                fl['ribbon'][i, bn] = cur
                fl['lead'][i, bn] = 1 if cur < 0 else (-1 if cur > 0 else 0)   # 1 = AWAY leads
            away_first = None
            for per, clk, off, is_pass, diff in tr:
                team = home if off == 0 else away
                d = diff if off == 0 else -diff
                fl['calls'][team][state_of(d)][1 if is_pass else 0] += 1
                fl['half'][team][1 if per <= 2 else 2][1 if is_pass else 0] += 1
                if away_first is None and diff < 0:
                    away_first = (per - 1) * 900 + (900 - clk)
            if m < 0:                                     # away won
                if away_first is not None:
                    fl['lead_taken'].append(away_first)
                if fl['ribbon'][i].max() <= 0:
                    fl['never_trailed'] += 1
            fl['biggest'].append(int(-fl['ribbon'][i].min()))
            if b and fl['ribbon'][i, 30] < 0 and m < 0 and b[1].get("rush_yds", 0) > b[0].get("rush_yds", 0):
                fl['script'] += 1
    if trace:
        E.TRACE = None
    E.DIAG["ypp"].clear(); E.DIAG["third"].clear()
    return mar, tot, hs, as_, ot, box, fl


def pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(p / 100.0 * len(v)))]


STATS = [("__pts", "points", 0), ("__yds", "total yards", 0), ("__ply", "plays", 0), ("__ypp", "yards per play", 1),
         ("rush_att", "rush attempts", 0), ("rush_yds", "rush yards", 0), ("__rypc", "yards per rush", 1),
         ("pass_att", "pass attempts", 0), ("completions", "completions", 0), ("pass_yds", "pass yards", 0),
         ("__yppa", "yards per attempt", 1), ("explosive", "explosive plays", 0), ("td", "touchdowns", 0),
         ("fga", "FG attempts", 0), ("fgm", "FG made", 0), ("punts", "punts", 0), ("int_thrown", "interceptions", 0),
         ("fum_lost", "fumbles lost", 0), ("takeaways", "takeaways", 0), ("sacks_made", "sacks by", 0),
         ("sacks_taken", "sacks allowed", 0), ("rz_trips", "red zone trips", 0), ("rz_td", "red zone TDs", 0),
         ("top", "time of possession", 0)]

for gid, slug, tz in GAMES:
    t0 = time.time()
    g = sb(f'games?select=id,home_team,away_team,start_date,neutral_site,week&id=eq.{gid}')[0]
    home, away = g['home_team'], g['away_team']
    slug = re.sub(r"[^a-z0-9]+", "", away.lower()) + "_" + re.sub(r"[^a-z0-9]+", "", home.lower())
    assert home in R and away in R, f"{away} @ {home}: unrated team"
    b = json.load(urllib.request.urlopen(f"{API}/canonical/games/{gid}/breakdown", timeout=300))
    mk = ((b.get('engine') or {}).get('margin') or {}).get('market_x')
    page_margin = ((b.get('engine') or {}).get('margin') or {}).get('mean')
    hfa = 0.0 if g.get('neutral_site') else HFA
    ch, ca = E.coach_of(hc[home]), E.coach_of(hc[away])
    # calibrate the rating bump so the mean margin moves by HFA (paired seeds)
    m0 = S.mean(run(home, away, ch, ca, NCAL, 0.0, 101)[0])
    m1 = S.mean(run(home, away, ch, ca, NCAL, 0.5, 101)[0])
    slope = (m1 - m0) / 0.5
    assert slope > 0.5, f"slope implausible {slope:.3f}"
    delta = hfa / slope if hfa else 0.0
    mar, tot, hs, as_, ot, box, fl = run(home, away, ch, ca, NSIM, delta, f"cards:{SEASON}:{WEEK}:{gid}", trace=True)
    realised = S.mean(mar) - m0
    print(f"{away} @ {home}: neutral(4k) {m0:+.2f}, delta {delta:.4f}, mean margin {S.mean(mar):+.2f} "
          f"(realised hfa {realised:+.2f}; page {page_margin}), total {S.mean(tot):.1f}, {time.time()-t0:.0f}s")
    for side, pts in ((home, hs), (away, as_)):
        bx = box[side]; n = len(pts)
        bx["__pts"] = list(pts)
        ry, py_ = bx.get("rush_yds", [0.0] * n), bx.get("pass_yds", [0.0] * n)
        ra, pa = bx.get("rush_att", [0.0] * n), bx.get("pass_att", [0.0] * n)
        bx["__yds"] = [x + y for x, y in zip(ry, py_)]
        bx["__ply"] = [x + y for x, y in zip(ra, pa)]
        bx["__ypp"] = [(x + y) / max(1.0, u + v) for x, y, u, v in zip(ry, py_, ra, pa)]
        bx["__rypc"] = [x / max(1.0, u) for x, u in zip(ry, ra)]
        bx["__yppa"] = [y / max(1.0, v) for y, v in zip(py_, pa)]
    am = [abs(x) for x in mar]; kn = Counter(am)
    kdt = datetime.fromisoformat(g['start_date']).astimezone(ZoneInfo(tz))
    part = {"one score (8 or less)": sum(1 for x in am if x <= 8) / NSIM,
            "two scores (9 to 16)": sum(1 for x in am if 9 <= x <= 16) / NSIM,
            "three scores (17 to 24)": sum(1 for x in am if 17 <= x <= 24) / NSIM,
            "four scores or more (25+)": sum(1 for x in am if x >= 25) / NSIM}
    out = {"home": home, "away": away, "nsim": NSIM, "date": kdt.strftime("%Y-%m-%d"),
           "kickoff_utc": g['start_date'], "kickoff_tz": tz, "week": g['week'],
           "kickoff_label": f"Week {g['week']}  ·  {kdt.strftime('%A, %B %#d')}  ·  {kdt.strftime('%#I:%M %p')} {kdt.tzname()}",
           "hc_home": hc[home], "hc_away": hc[away],
           "hfa_points": hfa, "hfa_rating_delta": delta, "hfa_realised": realised, "margin_neutral": m0,
           "margin_mean": S.mean(mar), "margin_sd": S.pstdev(mar), "total_mean": S.mean(tot),
           "pw_home": sum(1 for x in mar if x > 0) / NSIM,
           "score": {home: S.mean(hs), away: S.mean(as_)},
           "outcomes": part,
           "outcomes_nested": {"decided by 3 or less": sum(1 for x in am if x <= 3) / NSIM,
                               "decided by 7 or less": sum(1 for x in am if x <= 7) / NSIM,
                               "overtime": ot / NSIM},
           "total_sd": S.pstdev(tot),
           "mar_hist": {str(k): v for k, v in sorted(Counter(mar).items())},
           "tot_hist": {str(k): v for k, v in sorted(Counter(tot).items())},
           "margin_mode": Counter(mar).most_common(1)[0][0],
           "total_mode": Counter(tot).most_common(1)[0][0],
           "keynum": {str(k): kn[k] / NSIM for k in (1, 3, 4, 6, 7, 10, 14, 17)},
           "dist": {t: {str(p): pct(v, p) for p in (10, 25, 50, 75, 90)} for t, v in ((home, hs), (away, as_), ("total", tot))},
           "ratings": {t: R[t] for t in (home, away)},
           "market_margin": mk, "model_version": rows[0]['model_version'],
           # the page's histogram furniture: where the four models land and the market total
           "models_margin": {m_['name']: float(m_['home_margin']) for m_ in (((b.get('projections') or {}).get('spread') or {}).get('models') or [])
                             if m_.get('name') != 'Elo' and m_.get('home_margin') is not None},
           "models_total": {m_['name']: float(m_['total']) for m_ in (((b.get('projections') or {}).get('total') or {}).get('models') or [])
                            if m_.get('name') != 'Elo' and m_.get('total') is not None},
           "market_total": ((b.get('engine') or {}).get('total') or {}).get('market_x'),
           "box": []}
    for key, lab, dp in STATS:
        hv, av = box[home].get(key), box[away].get(key)
        if not hv or not av:
            continue
        out["box"].append({"stat": lab, "dp": dp, "key": key,
                           "home": {"p25": pct(hv, 25), "p50": S.median(hv), "p75": pct(hv, 75), "mean": S.mean(hv), "sd": S.pstdev(hv)},
                           "away": {"p25": pct(av, 25), "p50": S.median(av), "p75": pct(av, 75), "mean": S.mean(av), "sd": S.pstdev(av)}})
    assert abs((out["score"][home] - out["score"][away]) - out["margin_mean"]) < 0.02
    json.dump(out, open(os.path.join(SP, f"{slug}_box.json"), "w", encoding="utf-8"), indent=1)
    flow = {"nsim": NSIM, "home": home, "away": away,
            "ribbon": {str(p): [int(round(v)) for v in np.percentile(fl['ribbon'], p, axis=0)] for p in (10, 25, 50, 75, 90)},
            "p_miz_lead": [float((fl['lead'][:, bn] == 1).mean()) for bn in range(61)],
            "p_tied": [float((fl['lead'][:, bn] == 0).mean()) for bn in range(61)],
            "calls": {t: {s: {"rush": fl['calls'][t][s][0], "pass": fl['calls'][t][s][1],
                              "rush_share": fl['calls'][t][s][0] / max(1, sum(fl['calls'][t][s]))} for s in STATES} for t in (home, away)},
            "half": {t: {h: {"rush_share": fl['half'][t][h][0] / max(1, sum(fl['half'][t][h]))} for h in (1, 2)} for t in (home, away)},
            "lead_taken_sec": ({str(p): float(np.percentile(fl['lead_taken'], p)) for p in (25, 50, 75)} if fl['lead_taken'] else {}),
            "p_never_trailed_given_win": fl['never_trailed'] / max(1, sum(1 for m in mar if m < 0)),
            "biggest_miz_lead": {str(p): float(np.percentile(fl['biggest'], p)) for p in (25, 50, 75, 90)},
            "p_script": fl['script'] / NSIM, "p_miz_win": sum(1 for m in mar if m < 0) / NSIM}
    json.dump(flow, open(os.path.join(SP, f"{slug}_flow.json"), "w", encoding="utf-8"), indent=1)
    for script, args in (("game_projection_card.py", [f"{slug}_projection.png", f"{slug}_box.json"]),
                         ("game_flow_card.py", [f"{slug}_flow.png", f"{slug}_flow.json", f"{slug}_box.json"])):
        cmd = ["py", "-X", "utf8", os.path.join(SITE, "tools", script)] + [os.path.join(SP, a) for a in args]
        r = subprocess.run(cmd, cwd=SITE, capture_output=True, text=True)
        tail = (r.stdout.strip().splitlines() or [''])[-1]
        print(f"   {script}: exit {r.returncode} {tail[:100]} {('ERR ' + r.stderr.strip().splitlines()[-1][:160]) if r.returncode else ''}")
print("done")

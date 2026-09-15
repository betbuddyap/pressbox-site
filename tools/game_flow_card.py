# -*- coding: utf-8 -*-
"""How the game plays out — the shape of it, minute by minute.

    py -X utf8 tools/game_flow_card.py [--ink] [out.png] [mk_flow.json]

The companion to game_projection_card.py. That card says WHAT the
typical game looks like; this one says WHEN, which is the only way to
test a claim about sequence. Reads mk_flow.json from mk_flow.py, which
traces all 25,000 simulations play by play.

THE CHART PLOTS THE MARKET UNDERDOG'S LEAD, POSITIVE UPWARD, so the
favourite sits below zero exactly as a book quotes them. That is not a
break from the projection card's book convention -- it is the same
distinction that card already draws. A SPREAD is quoted with the
favourite negative (Missouri −7.8); a MARGIN is positive when the team
wins by it (+7.8). A flow chart is a margin, so up is ahead.

Same palette and type rules as the projection card: house serif for
display numbers, sans for inline ones, 0.03em tracking on small caps,
--sage/--rust reserved for data viz.
"""
import json
import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw, ImageFont

S = 2
W = 1080 * S
PAD = 56 * S

DARK = "--ink" in sys.argv or os.environ.get("CARD_THEME") == "ink"

LIGHT_PAL = dict(
    BG=(248, 245, 238), SURFACE=(239, 233, 220), RULE=(232, 225, 211),
    TEXT=(15, 14, 10), TEXT_SOFT=(62, 57, 46), MUTED=(138, 130, 114),
    ACCENT=(184, 146, 42), ACCENT_TEXT=(184, 134, 11),
    BAND1=(222, 212, 190), BAND2=(198, 183, 150), LINE=(15, 14, 10),
    LINE_WORD="Dark",
    AWAY_C=(241, 184, 45), HOME_C=(0, 81, 186),
    AREA_A=(233, 182, 60), AREA_H=(41, 94, 178),
    LOGO="pressbox-w2a-cream-cropped.png",
)
INK_PAL = dict(
    BG=(15, 14, 10), SURFACE=(28, 26, 21), RULE=(48, 45, 38),
    TEXT=(248, 245, 238), TEXT_SOFT=(196, 188, 172), MUTED=(150, 142, 126),
    ACCENT=(124, 98, 32),          # full-width rules: quiet
    ACCENT_TEXT=(198, 160, 70),    # 19pt headings: a notch down
    BAND1=(52, 47, 32), BAND2=(92, 79, 42), LINE=(248, 245, 238),
    LINE_WORD="White",
    AWAY_C=(197, 154, 52), HOME_C=(58, 114, 196),
    AREA_A=(163, 127, 43), AREA_H=(44, 86, 150),
    LOGO="pressbox-w2a-ink-cropped.png",
)
_P = INK_PAL if DARK else LIGHT_PAL
BG, SURFACE, RULE = _P["BG"], _P["SURFACE"], _P["RULE"]
TEXT, TEXT_SOFT, MUTED = _P["TEXT"], _P["TEXT_SOFT"], _P["MUTED"]
ACCENT, ACCENT_TEXT = _P["ACCENT"], _P["ACCENT_TEXT"]
BAND1, BAND2, LINE = _P["BAND1"], _P["BAND2"], _P["LINE"]
# the caption has to name the colour the theme actually draws
LINE_WORD = _P["LINE_WORD"]
# PALETTE DEFAULTS ONLY. These are Missouri gold and Kansas blue --
# the first matchup this card was built for -- and every other game was
# being drawn in them. Real team colours are resolved per game below.
AWAY_C, HOME_C = _P["AWAY_C"], _P["HOME_C"]
# big chart fills, deliberately quieter than the same team colour
# used on a 26px label
AREA_A, AREA_H = _P["AREA_A"], _P["AREA_H"]

TEAM_COLOUR = {
    "Missouri": (241, 184, 45), "Kansas": (0, 81, 186),
    "Kansas State": (81, 40, 136), "Washington State": (152, 30, 50),
    "Michigan": (0, 39, 76), "Oklahoma": (132, 22, 23),
    "Texas": (191, 87, 0), "Ohio State": (187, 0, 0),
    "Alabama": (158, 27, 50), "Georgia": (186, 12, 47),
    "Oregon": (0, 79, 57), "Penn State": (4, 30, 66),
    "LSU": (70, 29, 124), "Clemson": (245, 102, 0),
    "Notre Dame": (12, 35, 64), "Miami": (240, 129, 32),
    "Tennessee": (255, 130, 0), "Florida": (0, 33, 165),
    "Auburn": (12, 35, 64), "Nebraska": (208, 0, 0),
    "USC": (153, 27, 30), "UCLA": (39, 116, 174),
    "Wisconsin": (197, 5, 12), "Iowa": (0, 0, 0),
    "Utah": (204, 0, 0), "Baylor": (21, 71, 52),
    "TCU": (77, 25, 121), "Oklahoma State": (255, 103, 0),
    "Arkansas": (157, 34, 53), "Missouri State": (110, 38, 14),
}


def lift(c, amt=0.42):
    """Dark team colours vanish on ink; lift toward cream for that theme."""
    return tuple(int(round(v + (248 - v) * amt)) for v in c)


def tone(c, amt=0.18):
    """A large fill wants to sit back from the same colour on a label."""
    b = BG
    return tuple(int(round(v + (b[i] - v) * amt)) for i, v in enumerate(c))


def dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def team_pair(away, home):
    """Shared resolver -- see tools/team_colours.resolve_pair."""
    return resolve_pair(away, home, AWAY_C, HOME_C, DARK, BG)


# Team colours live in ONE table now (tools/team_colours.py).
# Two copies drifted: teams were added to the flow card only,
# so five of seven projection cards fell back to Missouri gold
# and Kansas blue while their flow cards were correct.
from team_colours import TEAM_COLOUR, resolve_pair


def lift(c, amt=0.42):
    """Dark team colours vanish on ink; lift toward cream for that theme."""
    return tuple(int(round(v + (248 - v) * amt)) for v in c)


def team_colour(name, fallback):
    c = TEAM_COLOUR.get(name)
    if c is None:
        return fallback
    return lift(c) if DARK and sum(c) < 300 else c


F = "C:/Windows/Fonts"


def font(f, s):
    return ImageFont.truetype(os.path.join(F, f), s * S)


f_title = font("georgiab.ttf", 44)
f_big = font("georgiab.ttf", 46)
f_meta = font("segoeui.ttf", 16)
f_note = font("segoeui.ttf", 14)
f_lbl = font("seguisb.ttf", 13)
f_sect = font("seguisb.ttf", 15)
f_val = font("seguisb.ttf", 19)
f_axis = font("segoeui.ttf", 12)
f_body = font("segoeui.ttf", 17)


def track(dr, xy, text, fnt, fill, size, anchor="l", em=0.03):
    tr = em * size * S
    ws = [fnt.getlength(c) for c in text]
    total = sum(ws) + tr * (len(text) - 1)
    x, y = xy
    if anchor == "m":
        x -= total / 2
    elif anchor == "r":
        x -= total
    for c, cw in zip(text, ws):
        dr.text((x, y), c, font=fnt, fill=fill)
        x += cw + tr
    return total


def wrap(dr, text, fnt, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if fnt.getlength(t) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = args[0] if args else ("game_flow_ink.png" if DARK
                                else "game_flow.png")
    scratch = os.path.join(
        os.environ.get("TEMP", ""), "claude",
        "C--Users-AustinPark-Documents-GitHub-pressbox-site",
        "b8b48263-e617-4758-aab0-7c787f9e200a", "scratchpad")
    D = json.load(open(args[1] if len(args) > 1 else
                       os.path.join(scratch, "mk_flow.json"),
                       encoding="utf-8"))
    K = json.load(open(args[2] if len(args) > 2 else
                       os.path.join(scratch, "mk_box.json"),
                       encoding="utf-8"))
    home, away = D["home"], D["away"]
    C_AWAY, C_HOME = team_pair(away, home)
    # engine margin is home-minus-away; the axis is signed off the
    # MARKET so the favourite is always below zero (see rib, above)
    # NEGATIVE IS THE FAVOURITE, same as the projection card. This was
    # a flat negation of the home margin, which put the market's
    # favourite on the POSITIVE side whenever that favourite was the
    # AWAY team -- Oklahoma at Michigan. Sign it off the market instead.
    _mk = K.get("market_margin")
    _mk = None if _mk is None else float(_mk)
    if _mk is not None and abs(_mk) > 1e-9:
        FLIP = -1 if _mk > 0 else 1
        x_fav = home if _mk > 0 else away
    else:
        FLIP = -1 if K["margin_mean"] > 0 else 1
        x_fav = home if K["margin_mean"] > 0 else away
    x_dog = away if x_fav == home else home
    rib = {p: [FLIP * v for v in D["ribbon"][p]] for p in D["ribbon"]}

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, _P["LOGO"])
    logo = lmask = None
    if os.path.exists(lp):
        logo = Image.open(lp).convert("RGB")
        h_ = 74 * S
        logo = logo.resize(
            (int(logo.width * h_ / logo.height), h_), Image.LANCZOS)
        if DARK:
            lmask = logo.convert("L").point(
                lambda v: int(255 * (v / 255.0) ** 0.5))

    img = Image.new("RGB", (W, 2600 * S), BG)
    dr = ImageDraw.Draw(img)

    y = 44 * S
    if logo:
        img.paste(logo, (PAD, y), lmask)
    track(dr, (W - PAD, y + 30 * S), "GAME FLOW", f_sect, TEXT_SOFT, 15,
          anchor="r")
    y += 92 * S
    dr.rectangle([PAD, y, W - PAD, y + 1 * S], fill=RULE)
    y += 34 * S
    dr.text((PAD, y), "How the game plays out", font=f_title, fill=TEXT)
    y += 62 * S
    dr.text((PAD, y), f"{away} at {home}  ·  {K['kickoff_label']}",
            font=f_meta, fill=TEXT_SOFT)
    y += 26 * S
    dr.text((PAD, y), f"Every play of {D['nsim']:,} simulations, traced. "
                      "The band is where the game actually sits — not a "
                      "single storyline.", font=f_note, fill=MUTED)
    y += 58 * S

    # ---- the ribbon --------------------------------------------------
    CH = 300 * S
    lo = min(rib["10"] + rib["90"]) - 3
    hi = max(rib["10"] + rib["90"]) + 3
    lo, hi = int(lo // 7 * 7), int(-(-hi // 7) * 7)
    cw = W - 2 * PAD
    top = y

    def px(m):
        return PAD + cw * m / 60.0

    def py(v):
        return top + CH * (hi - v) / (hi - lo)

    for q in (15, 30, 45):
        dr.rectangle([px(q), top, px(q) + 1 * S, top + CH], fill=RULE)
    for v in range(lo, hi + 1, 7):
        yy = py(v)
        dr.rectangle([PAD, yy, W - PAD, yy + 1 * S],
                     fill=MUTED if v == 0 else RULE)
        dr.text((PAD - 10 * S, yy), f"{v:+d}" if v else "0", font=f_axis,
                fill=MUTED, anchor="rm")
    for pair, col in ((("10", "90"), BAND1), (("25", "75"), BAND2)):
        a, b = rib[pair[0]], rib[pair[1]]
        poly = ([(px(m), py(a[m])) for m in range(61)]
                + [(px(m), py(b[m])) for m in range(60, -1, -1)])
        dr.polygon(poly, fill=col)
    med = rib["50"]
    dr.line([(px(m), py(med[m])) for m in range(61)], fill=LINE,
            width=3 * S, joint="curve")
    for q, lab in ((7.5, "1ST"), (22.5, "2ND"), (37.5, "3RD"),
                   (52.5, "4TH")):
        dr.text((px(q), top + CH + 10 * S), lab, font=f_axis, fill=MUTED,
                anchor="ma")
    track(dr, (PAD, top - 26 * S), f"{x_dog.upper()} LEAD, POINTS",
          f_lbl, TEXT_SOFT, 13)
    y = top + CH + 40 * S
    dr.text((PAD, y), f"{LINE_WORD} line is the median game. Inner "
                      "band holds half of all simulations, outer band "
                      "eight in ten.", font=f_note, fill=MUTED)
    y += 42 * S

    # ---- who leads, when ---------------------------------------------
    track(dr, (PAD, y), "SHARE OF SIMULATIONS WITH A LEAD", f_sect, TEXT,
          15)
    y += 32 * S
    BH = 92 * S
    pl = D["p_miz_lead"]
    pt = D["p_tied"]
    # Filled polygons across all 61 minutes, so the boundaries are
    # interpolated lines rather than 61 hard-edged one-minute columns.
    # A 3-point mean takes the Monte Carlo jitter off the edges without
    # moving any value enough to matter.
    def smooth(v):
        return [sum(v[max(0, i - 1):i + 2]) / len(v[max(0, i - 1):i + 2])
                for i in range(len(v))]

    pl, pt = smooth(pl), smooth(pt)
    top_e = [(px(m), y + BH * pl[m]) for m in range(61)]
    mid_e = [(px(m), y + BH * (pl[m] + pt[m])) for m in range(61)]
    dr.polygon([(PAD, y), (W - PAD, y)] + top_e[::-1], fill=tone(C_AWAY))
    dr.polygon(top_e + mid_e[::-1], fill=RULE)
    dr.polygon(mid_e + [(W - PAD, y + BH), (PAD, y + BH)],
               fill=tone(C_HOME))
    y += BH + 12 * S
    for m, lab in ((0, "kick"), (15, "Q2"), (30, "half"), (45, "Q4"),
                   (60, "final")):
        dr.text((min(px(m), W - PAD), y), lab, font=f_axis, fill=MUTED,
                anchor="ma" if 0 < m < 60 else
                ("la" if m == 0 else "ra"))
    y += 26 * S
    dr.text((PAD, y), f"{away} on top in their colour, {home} beneath "
                      f"in theirs, tied in between. "
                      f"{away} lead {pl[15]:.0%} of games at the end of "
                      f"the first quarter and {pl[30]:.0%} at half.",
            font=f_note, fill=MUTED)
    y += 44 * S

    # ---- the thing the box score cannot show -------------------------
    track(dr, (PAD, y), "RUSH SHARE BY SCORE STATE", f_sect, TEXT, 15)
    y += 34 * S
    STATES = ["trailing 9+", "trailing 1-8", "tied", "leading 1-8",
              "leading 9+"]
    colw = (W - 2 * PAD - 200 * S) / len(STATES)
    # TRACK BOUNDS FROM THE DATA. These were hardcoded 40-70%, which is
    # right for a balanced game and crashes on a pass-first one -- the
    # bar width went negative the first time a share came in under 40%.
    _v = [D["calls"][t][s]["rush_share"] for t in (away, home)
          for s in STATES]
    RLO = min(0.40, (min(_v) * 20 // 1) / 20)          # down to a 5% mark
    RHI = max(0.70, -(-max(_v) * 20 // 1) / 20)        # up to a 5% mark
    RSP = max(RHI - RLO, 0.10)
    for i, s in enumerate(STATES):
        dr.text((PAD + 200 * S + colw * (i + 0.5), y), s, font=f_axis,
                fill=MUTED, anchor="ma")
    y += 24 * S
    for t, col in ((away, C_AWAY), (home, C_HOME)):
        dr.text((PAD, y), t, font=f_val, fill=TEXT)
        for i, s in enumerate(STATES):
            v = D["calls"][t][s]["rush_share"]
            cx = PAD + 200 * S + colw * (i + 0.5)
            bw = colw * 0.62
            dr.text((cx, y), f"{v:.0%}", font=f_val, fill=TEXT,
                    anchor="ma")
            dr.rectangle([cx - bw / 2, y + 34 * S, cx + bw / 2,
                          y + 44 * S], fill=RULE)
            f = min(max((v - RLO) / RSP, 0.0), 1.0)
            dr.rectangle([cx - bw / 2, y + 34 * S,
                          cx - bw / 2 + bw * f, y + 44 * S], fill=col)
        y += 64 * S
    y += 6 * S
    dr.text((PAD, y), f"Bars scaled {RLO:.0%}–{RHI:.0%}. Read across, "
                      "not down: both sides run more as they get further "
                      "ahead.", font=f_note, fill=MUTED)
    y += 46 * S

    # ---- narrative ----------------------------------------------------
    dr.rectangle([PAD, y, W - PAD, y + 3 * S], fill=ACCENT)
    y += 26 * S
    h1 = D["half"][away]["1"]["rush_share"] if "1" in D["half"][away] \
        else D["half"][away][1]["rush_share"]
    h2 = D["half"][away]["2"]["rush_share"] if "2" in D["half"][away] \
        else D["half"][away][2]["rush_share"]
    k1 = D["half"][home]["1"]["rush_share"] if "1" in D["half"][home] \
        else D["half"][home][1]["rush_share"]
    k2 = D["half"][home]["2"]["rush_share"] if "2" in D["half"][home] \
        else D["half"][home][2]["rush_share"]
    lead50 = D["lead_taken_sec"].get("50", 0)
    tied_m = D["calls"][away]["tied"]["rush_share"]
    tied_k = D["calls"][home]["tied"]["rush_share"]
    ypr_m = next(b for b in K["box"] if b["stat"] == "yards per rush")
    # Negating a series swaps its percentile labels: rib['10'] holds the
    # 90th percentile of MISSOURI's lead. Take the ends by VALUE so the
    # sentence below cannot end up backwards.
    def span(v):
        return (f"{x_dog} by {v:.0f}" if v > 0
                else f"{x_fav} by {abs(v):.0f}")
    F10LO = min(rib["10"][60], rib["90"][60])
    F10HI = max(rib["10"][60], rib["90"][60])
    F25LO = min(rib["25"][60], rib["75"][60])
    F25HI = max(rib["25"][60], rib["75"][60])
    _mh = K["mar_hist"]
    MODE_P = _mh[str(K["margin_mode"])] / sum(_mh.values())
    # ORIENTATION. Every sentence below used to assume the AWAY team was
    # the favourite -- true for Missouri/Kansas and for Ohio State at
    # Texas, false for Oklahoma at Michigan, where it credited the
    # underdog with the edge that produces the lead and reported the
    # mean and the mode against the wrong team. Derive fav/dog from the
    # projection and name teams by comparison, never by home/away slot.
    fav_home = K["margin_mean"] > 0
    fav, dog = (home, away) if fav_home else (away, home)
    dog_p = (1 - K["pw_home"]) if fav_home else K["pw_home"]

    def by(m):
        """A home-minus-away margin as (team, positive points)."""
        return (home, m) if m > 0 else (away, -m)

    def hi_lo(va, vh):
        """(team, value) pairs ordered high-first, away value first in."""
        return ((away, va), (home, vh)) if va >= vh else ((home, vh),
                                                          (away, va))
    fav_h1, fav_h2 = (k1, k2) if fav_home else (h1, h2)
    dog_h1, dog_h2 = (h1, h2) if fav_home else (k1, k2)
    (t_hi, v_hi), (t_lo, v_lo) = hi_lo(tied_m, tied_k)
    (y_hi, r_hi), (y_lo, r_lo) = hi_lo(ypr_m["away"]["mean"],
                                       ypr_m["home"]["mean"])
    mode_t, mode_n = by(K["margin_mode"])
    mean_t, mean_n = by(K["margin_mean"])
    nxt = K["mar_hist"].get("7" if fav_home else "-7", 0)
    med_t, med_n = by(D["ribbon"]["50"][60])
    # THE NARRATIVE IS FOUND, NOT ASSERTED.
    #
    # These four paragraphs used to be the Missouri/Kansas story with the
    # team names swapped in: they claimed yards-per-carry was "the
    # largest single edge on the card" without ever checking (in Ohio
    # State at Texas the real gap is yards per ATTEMPT, 8.4 to 6.5,
    # nearly five times the rushing gap), and they claimed rush share
    # rises with the lead on a team whose halves read 45% and 45%.
    # Austin's word for the result was "copy paste from the missouri
    # game". Everything below is derived per game and states what it
    # finds, including when it finds nothing.
    BOXD = {r["stat"]: r for r in K["box"]}
    # DIRECTION. "Belongs to" used to mean "has the bigger number", which
    # handed Ole Miss an edge for punting MORE (Austin, 9/15: "ole miss
    # will punt more and lsu will have better passing and somehow those
    # two things keep the game close?"). Fewer is better on these.
    LOWER_BETTER = {"punts", "sacks allowed", "interceptions",
                    "fumbles lost"}

    def gap(stat):
        """(favourite - other) gap, its size in pooled sd units, the two
        means, and the ADVANTAGE sign: positive when the gap favours the
        favourite once the stat's direction is taken into account."""
        r = BOXD[stat]
        fa, fb = (r["home"], r["away"]) if fav_home else (r["away"],
                                                          r["home"])
        sd = ((fa["sd"] ** 2 + fb["sd"] ** 2) / 2) ** 0.5
        d = fa["mean"] - fb["mean"]
        z = d / sd if sd else 0.0
        adv = -z if stat in LOWER_BETTER else z
        return d, z, fa["mean"], fb["mean"], adv

    # YARDS PER PLAY IS DELIBERATELY NOT IN HERE. It is a BLEND of the
    # two phases, so it has the tightest sd and won the ranking in 4 of
    # 7 games -- and "it is won and lost on every snap" says nothing
    # about the game. Rank only real phases, so the headline names one.
    EDGES = [("yards per attempt", "through the air", "passing"),
             ("yards per rush", "on the ground", "rushing"),
             ("explosive plays", "in chunks", "explosive-play")]
    scored = []
    for st, phrase, kind in EDGES:
        if st in BOXD:
            d, z, fv, ov, adv = gap(st)
            scored.append((abs(z), adv, d, fv, ov, st, phrase, kind))
    scored.sort(reverse=True)
    _, adv1, d1, fv1, ov1, st1, ph1, kind1 = scored[0]
    st2, z2 = (scored[1][5], scored[1][1]) if len(scored) > 1 else (None, 0)
    dp1 = 1 if "per" in st1 else 0
    # the OWNER is the team the edge favours; its number is printed first
    owner, other = (fav, dog) if adv1 > 0 else (dog, fav)
    hi1, lo1 = (fv1, ov1) if owner == fav else (ov1, fv1)
    z1 = adv1

    def swing(t):
        c = D["calls"][t]
        return (c["leading 9+"]["rush_share"]
                - c["trailing 9+"]["rush_share"])
    sw_f, sw_d = swing(fav), swing(dog)
    responsive = min(sw_f, sw_d) >= 0.08

    # THE THIRD PARAGRAPH USED TO ASSERT "the run game is the
    # consequence, not the cause" -- which fired in 7 of 7 games,
    # because every team in the engine runs more with a lead. That is a
    # property of football, not a finding about THIS game. It now hunts
    # the widest separation OUTSIDE the phase paragraph two already
    # named, so it says something new every time.
    SECOND = [("explosive plays", "the big play", 0),
              ("red zone TDs", "what they do inside the twenty", 0),
              ("takeaways", "the takeaway battle", 0),
              ("sacks by", "the pass rush", 0),
              ("punts", "how often drives die", 0),
              ("plays", "sheer volume of snaps", 0),
              ("time of possession", "who holds the ball", 0),
              ("yards per rush", "the ground game", 1),
              ("yards per attempt", "the passing game", 1)]
    # RANK BY WHAT IS UNUSUAL FOR THIS GAME, NOT BY RAW SEPARATION.
    # Raw |z| kept picking time of possession (4 of 7) simply because
    # ToP separates more than anything else in EVERY game -- its slate
    # mean |z| is 1.00 against 0.04 for takeaways. Scored against each
    # stat's own baseline, a 1.0 on ToP is ordinary and a 0.5 on
    # takeaways is remarkable. edge_ref.json carries those baselines;
    # without it, fall back to raw |z|.
    REF = {}
    _rp = os.path.join(os.path.dirname(os.path.abspath(args[1])),
                       "edge_ref.json")
    if os.path.exists(_rp):
        REF = json.load(open(_rp, encoding="utf-8"))
    used = st1
    sec = []
    for st, phrase, dp in SECOND:
        if st == used or st not in BOXD:
            continue
        d, z, fv, ov, adv = gap(st)
        r = REF.get(st)
        # Only UNUSUALLY LARGE counts. Scoring the absolute deviation
        # rewarded being unusually LEVEL too, and picked takeaways at
        # |z| = 0.00 -- "neither team has an edge" is not a story. The
        # 0.30 floor keeps a statistically striking but tiny gap
        # (takeaways at 0.09 scored 2.13 against a 0.04 baseline) from
        # leading the paragraph.
        score = ((abs(z) - r["mean"]) / r["sd"]) if r else abs(z)
        if abs(z) >= 0.30 and score > 0:
            sec.append((score, adv, d, fv, ov, st, phrase, dp))
    sec.sort(reverse=True)
    if not sec:                      # nothing stands out: take the widest
        for st, phrase, dp in SECOND:
            if st == used or st not in BOXD:
                continue
            d, z, fv, ov, adv = gap(st)
            sec.append((abs(z), adv, d, fv, ov, st, phrase, dp))
        sec.sort(reverse=True)
    s_az, s_z, s_d, s_fv, s_ov, s_st, s_ph, s_dp = sec[0]
    s_owner, s_other = (fav, dog) if s_z > 0 else (dog, fav)
    s_hi, s_lo = (s_fv, s_ov) if s_owner == fav else (s_ov, s_fv)
    if s_st == "time of possession":
        s_hi, s_lo = s_hi / 60.0, s_lo / 60.0
        s_dp = 1
    fav_h1, fav_h2 = (k1, k2) if fav_home else (h1, h2)
    dog_h1, dog_h2 = (h1, h2) if fav_home else (k1, k2)
    flat = [t for t, x, y in ((fav, fav_h1, fav_h2), (dog, dog_h1, dog_h2))
            if abs(y - x) < 0.02]

    def by(m):
        """A home-minus-away margin as (team, positive points)."""
        return (home, m) if m > 0 else (away, -m)
    mode_t, mode_n = by(K["margin_mode"])
    mean_t, mean_n = by(K["margin_mean"])
    nxt = K["mar_hist"].get("7" if fav_home else "-7", 0)
    med_t, med_n = by(D["ribbon"]["50"][60])
    close = abs(K["margin_mean"]) < 7

    def fav_lead(m):
        return pl[m] if fav is away else 1 - pl[m]
    lead_end = fav_lead(60)
    drift = lead_end - fav_lead(15)
    # "sits there" is a CLAIM ABOUT MOVEMENT and has to be tested. In
    # Ohio State at Texas the favourite's lead share runs 54% -> 71%
    # and the median margin 3 -> 10: it widens all afternoon, and the
    # card said it sat still.
    RB = D["ribbon"]["50"]
    mpath = [abs(RB[m]) for m in (15, 30, 45, 60)]
    if drift >= 0.08:
        h1_head = "The lead arrives early and then keeps widening."
    elif drift <= -0.08:
        h1_head = "The favourite's grip loosens as it goes."
    elif close:
        h1_head = "Nobody runs away with this one."
    else:
        h1_head = "The lead arrives early and then just sits there."
    # THE FAVOURITE'S lead statistics, whichever slot it is in. Dumps
    # written before 9/15 carry the away team's only (Missouri was the
    # away favourite); those fall back to the legacy keys and NAME the
    # away team, so the sentence can never describe the wrong side.
    SS = (D.get("side_stats") or {}).get(fav)
    if SS:
        who = fav
        lead50 = (SS.get("lead_taken_sec") or {}).get("50", 0)
        never_p = SS["p_never_trailed_given_win"]
    else:
        who = away
        never_p = D["p_never_trailed_given_win"]
    paras = [
        (h1_head,
         f"{who} take their first lead at a median {int(lead50 // 60)}:"
         f"{int(lead50 % 60):02d} of game clock, and in "
         f"{never_p:.0%} of the games they win "
         f"they never trail at any point. The median game is "
         + ("level at the first quarter" if mpath[0] < 0.5 else
            f"{fav} by {mpath[0]:.0f} at the first quarter")
         + f", {fav} by {mpath[1]:.0f} at half and {mpath[3]:.0f} at "
           f"the end, with {fav}'s share of the lead going "
           f"{fav_lead(15):.0%} to {lead_end:.0%} from one to the "
           f"other."),
        (f"It is won and lost {ph1}.",
         f"Across every per-play measure on the card the widest "
         f"separation is {st1}: {owner} {hi1:.{dp1}f} against "
         f"{lo1:.{dp1}f} for {other}, which is "
         f"{abs(z1):.2f} pooled standard deviations apart"
         + (f" — against {abs(z2):.2f} for {st2}, the next largest. "
            if st2 else ". ")
         + (f"That is the {kind1} edge doing the work, and it belongs to "
            f"the favourite." if owner == fav else
            f"That edge belongs to the UNDERDOG, which is a large part "
            f"of why this projects closer than the two names suggest.")),
        (f"Then it is {s_ph}.",
         f"The widest separation outside {st1} is {s_st}: {s_owner} "
         f"{s_hi:.{s_dp}f} against {s_lo:.{s_dp}f}"
         + (" minutes" if s_st == "time of possession" else "")
         + f" for {s_other}, {abs(s_z):.2f} pooled standard deviations "
           f"apart"
         + (f", and it belongs to the favourite too — the two "
            f"edges stack." if s_owner == fav and owner == fav else
            f", and it belongs to the favourite, pulling the other way "
            f"from the first." if s_owner == fav else
            f", and unlike the first it belongs to {s_owner}, which is "
            f"what keeps this closer than one number suggests."
            if owner == fav else
            f", and it belongs to the underdog as well.")
         + (f" Play-calling then follows the scoreboard rather than "
            f"driving it: from trailing by nine to leading by nine "
            f"{fav}'s rush share swings {sw_f:+.0%} and {dog}'s "
            f"{sw_d:+.0%}, which is normal and tells you little."
            if responsive else
            f" Play-calling barely moves with the score here — "
            f"{fav} swing {sw_f:+.0%} and {dog} {sw_d:+.0%} between "
            f"trailing and leading by nine, which is unusually flat.")),
        ("And the width is a finding of its own.",
         f"A single projected score would hide the most useful thing "
         f"here. Half of these games finish between {span(F25LO)} "
         f"and {span(F25HI)}, eight in ten between {span(F10LO)} and "
         f"{span(F10HI)} — which is exactly why {dog} still take "
         f"{dog_p:.0%} of them while trailing in the median game. The "
         f"same distribution locates the result better than the average "
         f"does: the most common single outcome is not {mean_t} by "
         f"{mean_n:.1f} but {mode_t} by {mode_n:.0f}, landing "
         f"{MODE_P:.1%} of the time, with {fav} by 7 next at "
         f"{nxt / sum(K['mar_hist'].values()):.1%}."),
    ]
    for head, body in paras:
        dr.text((PAD, y), head, font=f_val, fill=ACCENT_TEXT)
        y += 30 * S
        for ln in wrap(dr, body, f_body, W - 2 * PAD):
            dr.text((PAD, y), ln, font=f_body, fill=TEXT)
            y += 27 * S
        y += 20 * S

    y += 14 * S
    dr.rectangle([PAD, y, W - PAD, y + 3 * S], fill=ACCENT)
    y += 24 * S
    track(dr, (PAD, y), "PRESSBOXANALYTICS.COM", f_lbl, ACCENT_TEXT, 13)
    track(dr, (W - PAD, y), "PROJECTION · GAME NOT YET PLAYED", f_lbl,
          MUTED, 13, anchor="r")
    bot = y + 40 * S
    img.crop((0, 0, W, bot)).save(out, "PNG")
    print(f"wrote {out}  ({W}x{bot})")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""How the game plays out — the shape of it, minute by minute.

    py -X utf8 tools/game_flow_card.py [--ink] [out.png] [mk_flow.json]

The companion to game_projection_card.py. That card says WHAT the
typical game looks like; this one says WHEN, which is the only way to
test a claim about sequence. Charts only: the generated narrative that
followed them never read as game-specific and was dropped 2026-09-15. Reads mk_flow.json from mk_flow.py, which
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

    # NO NARRATIVE (Austin, 9/15: "they don't feel game specific. we can
    # probably just drop them"). The charts carry the card; the four
    # generated paragraphs that used to follow them are gone.
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

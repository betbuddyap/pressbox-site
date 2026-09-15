# -*- coding: utf-8 -*-
"""Game projection drill-down — one game, engine output, postable.

    py -X utf8 tools/game_projection_card.py [out.png] [mk_box.json]

An ANALYTICAL card, not a pick card. It leads with the distribution
rather than a number: every figure carries its own spread, the margin
histogram is the centrepiece, and nothing on it tells anyone what to
bet. There is no win-probability hero and no spread badge, because a
projection that opens with a price reads as a tout sheet whatever the
numbers underneath it say.

HOUSE STYLE, which earlier cuts of this card broke:
  * `--serif` is 'Libre Baskerville', Georgia, serif and `--sans` is
    'Source Sans 3', system-ui -- so on Windows, Georgia and Segoe UI
    are not substitutes, they are literally what the stylesheet asks
    for. Big/display numbers take the serif, small/inline numbers the
    sans (tokens.css, and Austin has corrected it many times).
  * Letter-spacing on small caps is ~0.03em and NEVER 0.1em+. Earlier
    versions ran ~0.28em, which is most of why they read as somebody
    else's brand.
  * --sage and --rust are DATA-VIZ ONLY. A +/- variance is data viz, so
    they are allowed here and nowhere else on the card.
  * Cream ground, not a dark broadcast slab: live-lines.html is the
    canonical surface and a research note should look like the product.

Every number is read from mk_box.json. Nothing is typed in, because the
one thing a projection cannot survive is a figure that does not trace to
the run -- a reference mock-up for this card carried invented team
records and they were wrong.
"""
import json
import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.abspath(__file__)))
from collections import Counter

from PIL import Image, ImageDraw, ImageFont

S = 2
W = 1080 * S
PAD = 56 * S

DARK = "--ink" in sys.argv or os.environ.get("CARD_THEME") == "ink"

# One palette per theme, addressed by ROLE. tokens.css is the authority
# for both: --gold-light is "the on-dark gold" (plain --gold reads dim on
# a dark ground) and --gold-deep is the small-text gold for light, since
# thin glyphs lose saturation perceptually.
LIGHT_PAL = dict(
    BG=(248, 245, 238),          # --cream
    SURFACE=(239, 233, 220),     # --cream-dark
    RULE=(232, 225, 211),        # --cream-mid
    TEXT=(15, 14, 10),           # --ink
    TEXT_SOFT=(62, 57, 46),      # --ink-soft
    MUTED=(138, 130, 114),
    ACCENT=(184, 146, 42),       # --gold
    ACCENT_TEXT=(184, 134, 11),  # --gold-deep
    ACCENT_PALE=(245, 237, 208),  # --gold-pale
    MODE_C=(184, 90, 42),        # --rust
    BAR=(206, 199, 185),
    AWAY_C=(241, 184, 45),
    HOME_C=(0, 81, 186),
    SHADES=[(62, 57, 46), (110, 102, 86), (168, 159, 141),
            (214, 206, 190)],
    LOGO="pressbox-w2a-cream-cropped.png",
)
INK_PAL = dict(
    BG=(15, 14, 10),             # --ink
    SURFACE=(28, 26, 21),
    RULE=(48, 45, 38),
    TEXT=(248, 245, 238),        # --cream
    TEXT_SOFT=(196, 188, 172),
    MUTED=(150, 142, 126),
    ACCENT=(231, 190, 77),       # --gold-light, the on-dark gold
    ACCENT_TEXT=(231, 190, 77),
    ACCENT_PALE=(44, 37, 18),
    MODE_C=(209, 122, 74),       # --rust-light
    BAR=(74, 70, 60),
    AWAY_C=(241, 184, 45),
    HOME_C=(70, 142, 245),       # Kansas blue lifted to read on ink
    SHADES=[(232, 225, 211), (176, 168, 150), (120, 113, 98),
            (74, 70, 60)],
    LOGO="pressbox-w2a-ink-cropped.png",
)
_P = INK_PAL if DARK else LIGHT_PAL
BG, SURFACE, RULE = _P["BG"], _P["SURFACE"], _P["RULE"]
TEXT, TEXT_SOFT, MUTED = _P["TEXT"], _P["TEXT_SOFT"], _P["MUTED"]
ACCENT, ACCENT_TEXT = _P["ACCENT"], _P["ACCENT_TEXT"]
ACCENT_PALE, MODE_C, BAR = _P["ACCENT_PALE"], _P["MODE_C"], _P["BAR"]
AWAY_C, HOME_C = _P["AWAY_C"], _P["HOME_C"]
SHADES = _P["SHADES"]

# Team colours live in ONE table now (tools/team_colours.py).
# Two copies drifted: teams were added to the flow card only,
# so five of seven projection cards fell back to Missouri gold
# and Kansas blue while their flow cards were correct.
from team_colours import resolve_pair


def lift(c, amt=0.42):
    """Dark team colours vanish on ink; lift toward cream for that theme."""
    return tuple(int(round(v + (248 - v) * amt)) for v in c)





F = "C:/Windows/Fonts"


def font(file, size):
    return ImageFont.truetype(os.path.join(F, file), size * S)


SERIF, SERIF_B, SANS, SANS_SB = ("georgia.ttf", "georgiab.ttf",
                                 "segoeui.ttf", "seguisb.ttf")
f_title = font(SERIF_B, 46)
f_big = font(SERIF_B, 58)
f_mid = font(SERIF_B, 30)
f_meta = font(SANS, 16)
f_note = font(SANS, 14)
f_lbl = font(SANS_SB, 13)
f_sect = font(SANS_SB, 15)
f_val = font(SANS_SB, 19)
f_sd = font(SANS, 13)
f_axis = font(SANS, 12)
f_foot = font(SANS_SB, 14)

# (mk_box key, label, decimals) -- None starts a group
ROWS = [
    (None, "SCORING", None),
    ("points", "Points", 0),
    ("touchdowns", "Touchdowns", 0),
    ("red zone trips", "Red zone trips", 0),
    ("red zone TDs", "Red zone touchdowns", 0),
    (None, "MOVING THE BALL", None),
    ("total yards", "Total yards", 0),
    ("plays", "Plays", 0),
    ("yards per play", "Yards per play", 1),
    (None, "RUSHING", None),
    ("rush yards", "Rush yards", 0),
    ("rush attempts", "Rush attempts", 0),
    ("yards per rush", "Yards per rush", 1),
    (None, "PASSING", None),
    ("pass yards", "Pass yards", 0),
    ("yards per attempt", "Yards per attempt", 1),
    (None, "POSSESSION & DEFENCE", None),
    ("punts", "Punts", 0),
    ("takeaways", "Takeaways", 0),
    ("time of possession", "Time of possession", -1),
]


def fmt(v, dp):
    if dp is None:
        return ""
    if dp < 0:
        t = int(round(v))
        return f"{t // 60}:{t % 60:02d}"
    return f"{v:.{dp}f}"


def track(dr, xy, text, fnt, fill, size, anchor="l", em=0.03):
    """Letter-spacing at the house 0.03em, derived from the point size
    rather than guessed -- 0.1em+ reads as a different typeface."""
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


def _mix(a, b, t):
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))


def _keys(h, w=4, thr=1.22, cap=12, q=0.20):
    """This game's key numbers, MEASURED: bins carrying at least 1.22x the
    mass of their +/-4 neighbourhood, inside the central 60% of the
    distribution, capped at twelve so gold still means something."""
    tot = sum(h.values())
    c, klo, khi = 0, min(h), max(h)
    for m in sorted(h):
        c += h[m]
        if c >= q * tot and klo == min(h):
            klo = m
        if c <= (1 - q) * tot:
            khi = m
    out = []
    for m, cnt in h.items():
        if not (klo <= m <= khi):
            continue
        nb = [h.get(k, 0) for k in range(m - w, m + w + 1) if k != m]
        if not nb:
            continue
        base = sum(nb) / len(nb)
        if base > 0 and cnt >= thr * base:
            out.append((cnt, m))
    out.sort(reverse=True)
    return {m for _, m in out[:cap]}


def wrap_text(dr, y, text, fnt=None, fill=None, lead=22):
    fnt = fnt or f_note
    fill = fill or MUTED
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if fnt.getlength(t) > W - 2 * PAD and cur:
            lines.append(cur)
            cur = w_
        else:
            cur = t
    if cur:
        lines.append(cur)
    for ln in lines:
        dr.text((PAD, y), ln, font=fnt, fill=fill)
        y += lead * S
    return y


def page_hist(dr, y, title, hist, keys, markers, mean_x, market_x,
              market_label, dir_left, dir_right, signed=True, ch=170 * S,
              tick_step=7):
    """THE GAME PAGE'S ENGINE HISTOGRAM (charts.css .pg-hist-*), in PIL, and
    nothing the page shows about our pick: ink bars at 55%, key numbers
    gold, each model a hairline tick from the top with its name in one of
    three staggered rows, the engine's mean the same tick in gold, the
    market a dashed ink line with an ink chip at the foot, a value axis
    every `tick_step`, and the two direction words. Values arrive in
    DISPLAY coordinates (already flipped so the market favourite is
    negative). Returns (y, names of ticks that had no room for a label)."""
    track(dr, (PAD, y), title, f_sect, TEXT, 15)
    y += 30 * S
    n = sum(hist.values())
    acc, lo, hi = 0, min(hist), max(hist)
    for m in sorted(hist):                        # central 99% of the mass
        acc += hist[m]
        if acc <= 0.005 * n:
            lo = m
        if acc <= 0.995 * n:
            hi = m
    marks = list(markers.values())
    if mean_x is not None:
        marks.append(mean_x)
    if market_x is not None:
        marks.append(market_x)
    lo, hi = min([lo] + marks) - 2, max([hi] + marks) + 2
    span = float(hi - lo)
    x0, x1 = PAD, W - PAD

    def X(v):
        return x0 + (v - lo) / span * (x1 - x0)

    top, base = y, y + ch
    head = 50 * S                                 # three tick rows live here
    slot = (x1 - x0) / span
    bw = max(slot * 0.78, 2 * S)
    mx = max(hist.values())
    bar_col, key_col = _mix(BG, TEXT_SOFT, 0.55), _mix(BG, ACCENT, 0.95)
    for m, c in hist.items():
        if m < lo or m > hi:
            continue
        bh = (base - 2 * S - (top + head)) * (c / mx)
        xm = X(m)
        dr.rectangle([xm - bw / 2, base - 2 * S - bh, xm + bw / 2, base - 2 * S],
                     fill=key_col if m in keys else bar_col)
    dr.rectangle([x0, top, x1, base], outline=RULE, width=1 * S)
    if market_x is not None:
        xm = X(market_x)
        for yy in range(int(top), int(base), 10 * S):
            dr.rectangle([xm - 1 * S, yy, xm + 1 * S, min(yy + 5 * S, base)], fill=TEXT)
        if market_label:
            lab = market_label.upper()
            tw = f_axis.getlength(lab) + 14 * S
            cx = min(max(xm, x0 + tw / 2 + 4 * S), x1 - tw / 2 - 4 * S)
            dr.rounded_rectangle([cx - tw / 2, base - 26 * S, cx + tw / 2, base - 6 * S],
                                 radius=3 * S, fill=TEXT)
            dr.text((cx, base - 16 * S), lab, font=f_axis, fill=BG, anchor="mm")
    items = sorted([(v, name.upper(), False) for name, v in markers.items()]
                   + ([(mean_x, "ENGINE", True)] if mean_x is not None else []),
                   key=lambda t: t[0])
    placed, bare = [], []
    for v, name, is_eng in items:
        at = X(v)
        half = f_axis.getlength(name) / 2 + 5 * S
        row = next((r for r in range(3)
                    if not any(q[2] == r and abs(q[0] - at) < q[1] + half for q in placed)), -1)
        tick = (11 + 12 * max(row, 0)) * S
        hw = 1 * S if is_eng else 0.5 * S
        dr.rectangle([at - hw, top, at + hw, top + tick], fill=ACCENT if is_eng else TEXT_SOFT)
        if row < 0:
            shown = "the engine" if is_eng else name.title().replace("Sp+", "SP+").replace("Ppa", "PPA")
            bare.append(f"{shown} at {v:+.1f}" if signed else f"{shown} at {v:.1f}")
            continue
        placed.append((at, half, row))
        tx = min(max(at, x0 + half), x1 - half)
        dr.text((tx, top + tick + 3 * S), name, font=f_axis,
                fill=ACCENT_TEXT if is_eng else TEXT_SOFT, anchor="ma")
    ay = base + 8 * S
    first = -(-int(lo) // tick_step) * tick_step
    for v in range(first, int(hi) + 1, tick_step):
        p = (v - lo) / span
        if p < 0.03 or p > 0.97:
            continue
        lab = ((f"{v:+d}" if v else "0") if signed else f"{v}").replace("-", "−")
        dr.text((X(v), ay), lab, font=f_axis, fill=MUTED, anchor="ma")
    dr.text((x0, ay + 22 * S), dir_left.upper(), font=f_lbl, fill=TEXT_SOFT)
    dr.text((x1, ay + 22 * S), dir_right.upper(), font=f_lbl, fill=TEXT_SOFT, anchor="ra")
    return base + 60 * S, bare


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = args[0] if args else (
        "game_projection_ink.png" if DARK else "game_projection.png")
    scratch = os.path.join(
        os.environ.get("TEMP", ""), "claude",
        "C--Users-AustinPark-Documents-GitHub-pressbox-site",
        "b8b48263-e617-4758-aab0-7c787f9e200a", "scratchpad")
    src = args[1] if len(args) > 1 else os.path.join(
        scratch, "mk_box.json")
    D = json.load(open(src, encoding="utf-8"))
    BOX = {b["stat"]: b for b in D["box"]}
    miss = [k for k, _l, dp in ROWS if k and k not in BOX]
    assert not miss, f"mk_box.json has no {miss}"
    for k in ("mar_hist", "total_sd", "margin_mode",
              "kickoff_label"):
        assert k in D, f"mk_box.json predates this card: no {k}"
    away, home = D["away"], D["home"]
    # same resolver the flow card uses, so a game's two cards agree
    A_C, H_C = resolve_pair(away, home, AWAY_C, HOME_C, DARK, BG)

    # THE AXIS IS THE HOME TEAM'S MARGIN -- home minus away -- so
    # positive is always a HOME win and negative always an AWAY win.
    #
    # This is NOT the book's sign, and a comment here used to claim it
    # was. It coincides with the book only when the AWAY side is
    # favoured (Ohio State at Texas: book -9.7, ours -9.7). Flip the
    # favourite to the home side and the two part company (Oklahoma at
    # Michigan: book has Michigan -4.5, this axis has +3.4), which is
    # how the end labels came to name the wrong halves of the chart.
    # Label the ends by HOME and AWAY, never by favourite and dog.
    hist = {int(k): v for k, v in D["mar_hist"].items()}
    n = sum(hist.values())
    a_mar = D["margin_mean"]
    a_mode = D["margin_mode"]
    fav = home if a_mar > 0 else away
    dog = away if a_mar > 0 else home

    # CHART SPACE: NEGATIVE IS THE FAVOURITE, POSITIVE IS OUR PICK.
    # The histogram used to plot the HOME team's margin, so which end
    # carried the minus depended on who was at home. On Ohio State at
    # Texas that put the market's favourite (Texas -1.5) on the POSITIVE
    # side, inside out from the one rule the card states. Now x is
    # minus-the-market-favourite's-margin, so Texas and Oklahoma sit
    # negative and Ohio State and Michigan -- our picks -- sit positive,
    # matching the spread tile exactly.
    _mk = D.get("market_margin")
    _mk = None if _mk is None else float(_mk)
    if _mk is not None and abs(_mk) > 1e-9:
        FLIP = -1 if _mk > 0 else 1
        x_fav = home if _mk > 0 else away          # the MARKET's favourite
    else:
        FLIP = -1 if a_mar > 0 else 1              # no line: use ours
        x_fav = fav
    x_dog = away if x_fav == home else home
    hist = {FLIP * k: v for k, v in hist.items()}
    h_mar, h_mode = FLIP * a_mar, FLIP * a_mode
    h_mk = None if _mk is None else FLIP * _mk

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lp = os.path.join(here, _P["LOGO"])
    logo = lmask = None
    if os.path.exists(lp):
        logo = Image.open(lp).convert("RGB")
        h_ = 74 * S
        logo = logo.resize(
            (int(logo.width * h_ / logo.height), h_), Image.LANCZOS)
        if DARK:
            # the wordmark file is light artwork on an OPAQUE black
            # ground, so a straight paste stamps a box a shade off
            # our ink. Luminance is the real mask; the gamma keeps
            # the dim rule and ANALYTICS line from vanishing.
            lmask = logo.convert("L").point(
                lambda v: int(255 * (v / 255.0) ** 0.5))

    img = Image.new("RGB", (W, 3000 * S), BG)
    dr = ImageDraw.Draw(img)

    # ---- header ------------------------------------------------------
    y = 44 * S
    if logo:
        img.paste(logo, (PAD, y), lmask)
    track(dr, (W - PAD, y + 30 * S), "GAME PROJECTION", f_sect, TEXT_SOFT,
          15, anchor="r")
    y += 92 * S
    dr.rectangle([PAD, y, W - PAD, y + 1 * S], fill=RULE)
    y += 34 * S

    dr.text((PAD, y), f"{away} at {home}", font=f_title, fill=TEXT)
    y += 66 * S
    # NEVER hardcode the date. CFBD's start_date is UTC and this game's
    # 2026-09-12T00:00Z is a 7pm Central FRIDAY the 11th -- the card
    # said "Saturday, September 12" until Austin caught it hours before
    # kickoff. mk_box.json now carries the converted local label.
    dr.text((PAD, y), D["kickoff_label"], font=f_meta, fill=TEXT_SOFT)
    y += 26 * S
    dr.text((PAD, y), f"{D['nsim']:,} play-by-play simulations. Every "
                      "figure is a distribution, not a point estimate — "
                      "the ± is one standard deviation.",
            font=f_note, fill=MUTED)
    y += 32 * S

    # ---- four tiles --------------------------------------------------
    # THE SPREAD TILE: OUR NUMBER, SIGNED BY WHICH SIDE OF THE MARKET
    # IT LANDS ON.
    #
    # Magnitude is always OUR projected margin. Only the SIGN comes from
    # the market: minus when the side we favour is also the market's
    # favourite (Missouri -7.8, where we agreed), plus when the side we
    # favour is the market's underdog (Ohio State +9.7, Michigan +3.4).
    #
    # Two earlier cuts were both wrong. The first stamped a minus on our
    # own favourite regardless of the market, which put a minus on
    # Michigan -- a 4.5-point DOG on a +170 moneyline. The second
    # replaced the magnitude with the MARKET's line, which threw our
    # projection away entirely and, as Austin put it, "just took the
    # vegas line and flipped it positive".
    mk = D.get("market_margin")
    mk = None if mk is None else float(mk)
    if mk is not None and abs(mk) > 1e-9:
        # THE TEAM IS THE ONE WE PROJECT TO WIN. The sign says whether
        # that team is the market's favourite (minus) or underdog (plus).
        #
        # This used the ATS side -- whichever way our number sits
        # against the LINE -- which is a DIFFERENT question and only
        # matches when we also disagree about the winner. We make
        # Tennessee win by 10 while the market makes them a 12-point
        # favourite: same winner, so it must read Tennessee -10.0, not
        # Georgia Tech +10.0. Same for Utah -8.2 into a -12.5 line.
        # Ohio State +9.7 and Michigan +3.4 stay positive because there
        # we project the market's UNDERDOG to win.
        s_team = fav
        m_fav = home if mk > 0 else away
        on_dog = s_team != m_fav
        s_num = abs(a_mar) if on_dog else -abs(a_mar)
        sp_val = f"+{abs(a_mar):.1f}" if on_dog else f"−{abs(a_mar):.1f}"
        sp_sub = f"{s_team.upper()}  ·  ± {D['margin_sd']:.1f}"
    else:
        s_team, m_fav, on_dog, s_num = fav, None, False, -abs(a_mar)
        sp_val = f"−{abs(a_mar):.1f}"
        sp_sub = f"{fav.upper()}  ·  ± {D['margin_sd']:.1f}"
    TH = 122 * S
    gap = 14 * S
    tw = (W - 2 * PAD - 3 * gap) // 4
    pts_a, pts_h = BOX["points"]["away"], BOX["points"]["home"]
    tiles = [
        (away.upper(), f"{pts_a['mean']:.1f}", f"± {pts_a['sd']:.1f}",
         A_C),
        (home.upper(), f"{pts_h['mean']:.1f}", f"± {pts_h['sd']:.1f}",
         H_C),
        ("SPREAD", sp_val, sp_sub, ACCENT),
        ("TOTAL", f"{D['total_mean']:.1f}", f"± {D['total_sd']:.1f}", ACCENT),
    ]
    for i, (lab, val, sd, accent) in enumerate(tiles):
        x0 = PAD + i * (tw + gap)
        dr.rectangle([x0, y, x0 + tw, y + TH], fill=SURFACE)
        dr.rectangle([x0, y, x0 + tw, y + 4 * S], fill=accent)
        # f_big ascends ~106px above its baseline, so a label baseline
        # only 52px above it ran through the digit tops in every tile.
        track(dr, (x0 + tw // 2, y + 20 * S), lab, f_lbl, TEXT_SOFT, 13,
              anchor="m")
        dr.text((x0 + tw // 2, y + 84 * S), val, font=f_big, fill=TEXT,
                anchor="ms")
        dr.text((x0 + tw // 2, y + 106 * S), sd, font=f_sd, fill=MUTED,
                anchor="ms")
    y += TH + 12 * S
    dr.text((PAD, y),
            f"The chart below reads the way a book quotes: {x_fav} "
            f"negative, {x_dog} positive.", font=f_note, fill=MUTED)
    y += 34 * S
    # TWO DIFFERENT QUESTIONS, ANSWERED SEPARATELY.
    #   the TILE       = who we project to WIN, and by how much
    #   THE POSITION   = which side that makes us, AT the market number
    # They part company whenever we agree on the winner but not on the
    # size: we make Tennessee win by 10 into a 12-point line, so the
    # projection is Tennessee -10.0 and the position is Georgia Tech
    # +12.0. Collapsing the two into one number is what made the tile
    # read backwards.
    if m_fav is not None:
        # NO PICK BOXES (Austin, 9/15): the position line with its win and
        # cover probabilities is gone. The chart names the market and the
        # models; the board names our side.
        dr.text((PAD, y),
                f"That is our margin, not the market's: we project "
                f"{s_team} to win by {abs(a_mar):.1f}, while the market "
                f"makes {m_fav} the favourite by {abs(mk):.1f}.",
                font=f_note, fill=TEXT_SOFT)
        dr.text((PAD, y + 22 * S),
                ("We have the market's underdog winning, so our number "
                 "carries a plus."
                 if on_dog else
                 "We agree on the winner, so our number carries a minus "
                 "like the market's.")
                + f" The two differ by {abs(a_mar - mk):.1f} points.",
                font=f_note, fill=TEXT_SOFT)
        y += 66 * S

    # ---- margin distribution: the game page's chart, no pick boxes ----
    # KEY NUMBERS ARE MEASURED ON THIS GAME, NOT ASSERTED (see _keys).
    # NO MODE MARKER: the mode is +/-3 on 71% of simulated games and
    # unstable; mean and market are the honest pair, and the models are
    # the page's furniture.
    KEYS = _keys(hist)
    mk_margin = {nm: FLIP * v for nm, v in (D.get("models_margin") or {}).items()}
    y, bare_m = page_hist(
        dr, y, "MARGIN DISTRIBUTION", hist, KEYS, mk_margin, h_mar, h_mk,
        (f"{x_fav} −{abs(_mk):g}" if _mk is not None else None),
        f"◄  {x_fav} wins by more", f"{x_dog} covers  ►", signed=True)
    cap = ("Share of simulations finishing on each exact margin. Ticks mark "
           "where each of the four models lands and where the engine's mean "
           "sits; gold bars are this game's key numbers"
           + ("; the dashed line is the market." if _mk is not None else "."))
    if bare_m:
        cap += "  Unlabelled ticks: " + ", ".join(bare_m) + "."
    y = wrap_text(dr, y, cap) + 18 * S

    # ---- total distribution, same grammar (Austin, 9/15) -----------------
    thist = {int(k): v for k, v in D["tot_hist"].items()}
    mt = D.get("market_total")
    mt = None if mt is None else float(mt)
    y, bare_t = page_hist(
        dr, y, "TOTAL DISTRIBUTION", thist, _keys(thist),
        dict(D.get("models_total") or {}), D["total_mean"], mt,
        (f"total {mt:g}" if mt is not None else None),
        "◄  lower scoring", "higher scoring  ►", signed=False, ch=130 * S)
    cap2 = ("Points scored by both sides. The engine's total sits at "
            f"{D['total_mean']:.1f}"
            + (f" against a market of {mt:g}." if mt is not None else "."))
    if bare_t:
        cap2 += "  Unlabelled ticks: " + ", ".join(bare_t) + "."
    y = wrap_text(dr, y, cap2) + 16 * S

    # ---- team comparison ---------------------------------------------
    track(dr, (PAD, y), "PROJECTED BOX SCORE", f_sect, TEXT, 15)
    y += 32 * S
    CW = 250 * S
    ax = W - PAD - CW - 40 * S
    hx = W - PAD
    for cx, nm, col in ((ax, away, A_C), (hx, home, H_C)):
        dr.rectangle([cx - CW, y - 4 * S, cx, y - 1 * S], fill=col)
        track(dr, (cx, y + 16 * S), nm.upper(), f_lbl, TEXT_SOFT, 13,
              anchor="r")
    y += 34 * S
    for key, lab, dp in ROWS:
        if key is None:
            y += 6 * S
            track(dr, (PAD, y), lab, f_lbl, ACCENT_TEXT, 13)
            y += 24 * S
            dr.rectangle([PAD, y - 6 * S, W - PAD, y - 5 * S],
                         fill=RULE)
            continue
        b = BOX[key]
        dr.text((PAD, y + 4 * S), lab, font=f_meta, fill=TEXT)
        for cx, side in ((ax, b["away"]), (hx, b["home"])):
            dr.text((cx, y + 4 * S), fmt(side["mean"], dp), font=f_val,
                    fill=TEXT, anchor="ra")
            # dp flows straight through: a clock stat's spread is a
            # DURATION ("± 3:53"), not 233 loose seconds
            dr.text((cx, y + 24 * S), f"± {fmt(side['sd'], dp)}",
                    font=f_sd, fill=MUTED, anchor="ra")
        y += 42 * S
    y += 14 * S

    # ---- how the game lands ------------------------------------------
    track(dr, (PAD, y), "HOW THE GAME LANDS", f_sect, TEXT, 15)
    y += 32 * S
    part = D["outcomes"]
    assert abs(sum(part.values()) - 1.0) < 1e-6, "partition does not close"
    shades = SHADES
    BH = 30 * S
    x0 = PAD
    for (lab, p), col in zip(part.items(), shades):
        w_ = (W - 2 * PAD) * p
        dr.rectangle([x0, y, x0 + w_, y + BH], fill=col)
        x0 += w_
    y += BH + 20 * S
    for (lab, p), col in zip(part.items(), shades):
        dr.ellipse([PAD, y + 2 * S, PAD + 12 * S, y + 14 * S], fill=col)
        dr.text((PAD + 24 * S, y), lab[0].upper() + lab[1:], font=f_meta,
                fill=TEXT)
        dr.text((PAD + 560 * S, y), f"{p * 100:.1f}%", font=f_val,
                fill=TEXT, anchor="ra")
        y += 28 * S
    y += 6 * S
    nest = D["outcomes_nested"]
    dr.text((PAD, y), "Inside those bands, not additional to them:  "
            + "   ·   ".join(f"{k} {v * 100:.1f}%"
                             for k, v in nest.items()),
            font=f_note, fill=MUTED)
    y += 42 * S

    # ---- key numbers -------------------------------------------------
    track(dr, (PAD, y), "PROBABILITY THE MARGIN LANDS EXACTLY ON",
          f_sect, TEXT, 15)
    y += 34 * S
    kn = D["keynum"]
    kw = (W - 2 * PAD) // len(kn)
    for i, (k, v) in enumerate(kn.items()):
        x0 = PAD + i * kw
        dr.rectangle([x0, y, x0 + kw - 10 * S, y + 66 * S], fill=ACCENT_PALE)
        dr.text((x0 + (kw - 10 * S) // 2, y + 32 * S), k, font=f_mid,
                fill=ACCENT_TEXT, anchor="ms")
        dr.text((x0 + (kw - 10 * S) // 2, y + 56 * S), f"{v * 100:.1f}%",
                font=f_sd, fill=TEXT_SOFT, anchor="ms")
    y += 66 * S + 44 * S

    # ---- footer ------------------------------------------------------
    dr.rectangle([PAD, y, W - PAD, y + 3 * S], fill=ACCENT)
    y += 24 * S
    track(dr, (PAD, y), "PRESSBOXANALYTICS.COM", f_foot, ACCENT_TEXT, 14)
    track(dr, (W - PAD, y), "PROJECTION · GAME NOT YET PLAYED", f_foot,
          MUTED, 14, anchor="r")
    bot = y + 46 * S
    img.crop((0, 0, W, bot)).save(out, "PNG")
    print(f"wrote {out}  ({W}x{bot})")
    print(f"  {away} {pts_a['mean']:.1f}±{pts_a['sd']:.1f}   "
          f"{home} {pts_h['mean']:.1f}±{pts_h['sd']:.1f}   "
          f"margin {a_mar:+.2f}±{D['margin_sd']:.1f}  mode {a_mode:+d}   "
          f"total {D['total_mean']:.1f}±{D['total_sd']:.1f}")


if __name__ == "__main__":
    main()

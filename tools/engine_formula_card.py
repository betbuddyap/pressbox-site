# -*- coding: utf-8 -*-
"""THE ENGINE, WRITTEN OUT -- the whole Monte Carlo model as a card.

    py -X utf8 tools/engine_formula_card.py [--ink] [out.png]

Ten steps, from the league's average play to the vote on the board, in
the order a simulation actually runs. Every constant on the card is read
from the engine modules at render time (MEAN_SCALE, GAME_SIGMA, the
ridge, the blend weights, home field, sims per game, the fire gate), so
the card cannot drift from production the way prose about it would.

House style as the other cards: Georgia for display, Segoe for prose,
0.03em tracking on small caps, cream or ink ground. Cambria carries the
equations -- the one place a third face earns its keep, because a
formula set in a text face reads as a sentence that lost its verbs.
Equations use a tiny markup: _{x} is a subscript, ^{x} a superscript.
Formulas on one line are given as CHUNKS and packed left to right; a
chunk that will not fit starts a new line, so a formula never breaks
inside itself.
"""
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ENG = os.path.join(os.path.dirname(ROOT), "betbuddy-backend", "engine")
sys.path.insert(0, ENG)
sys.path.insert(0, os.path.dirname(ENG))

# ---- constants FROM the engine, never typed in ------------------------
import sim_engine2 as E                          # noqa: E402
import engine_week as W                          # noqa: E402
try:
    from pipeline.engine_blend import FIRE_EDGE  # noqa: E402
except Exception:                                # noqa: BLE001
    FIRE_EDGE = 3.0
MEAN_SCALE, GAME_SIGMA = E.MEAN_SCALE, E.GAME_SIGMA
HFA, NSIM, LAM = W.HFA_POINTS, W.NSIM_DEFAULT, W.LAM_WF
TEAM_NSIM = W.TEAM_NSIM_DEFAULT
WEIGHTS = [W.blend_w(1), W.blend_w(2), W.blend_w(4), W.blend_w(11)]
PRIOR_SCALE = 1.248        # week1_2026.SCALE, the prior's restoration factor

S = 2
Wd = 1080 * S
PAD = 56 * S
IND = 62 * S               # equation indent past the step number
GAP = 44 * S               # between formulas on one line
DARK = "--ink" in sys.argv or os.environ.get("CARD_THEME") == "ink"

LIGHT = dict(BG=(248, 245, 238), SURFACE=(239, 233, 220), RULE=(232, 225, 211),
             TEXT=(15, 14, 10), TEXT_SOFT=(62, 57, 46), MUTED=(138, 130, 114),
             ACCENT=(184, 146, 42), ACCENT_TEXT=(184, 134, 11),
             LOGO="pressbox-w2a-cream-cropped.png")
INK = dict(BG=(15, 14, 10), SURFACE=(28, 26, 21), RULE=(48, 45, 38),
           TEXT=(248, 245, 238), TEXT_SOFT=(196, 188, 172), MUTED=(150, 142, 126),
           ACCENT=(231, 190, 77), ACCENT_TEXT=(231, 190, 77),
           LOGO="pressbox-w2a-ink-cropped.png")
P = INK if DARK else LIGHT
BG, SURFACE, RULE = P["BG"], P["SURFACE"], P["RULE"]
TEXT, TEXT_SOFT, MUTED = P["TEXT"], P["TEXT_SOFT"], P["MUTED"]
ACCENT, ACCENT_TEXT = P["ACCENT"], P["ACCENT_TEXT"]

F = "C:/Windows/Fonts"


def font(f, size):
    return ImageFont.truetype(os.path.join(F, f), size * S)


f_title = font("georgiab.ttf", 50)
f_deck = font("segoeui.ttf", 17)
f_num = font("georgiab.ttf", 30)
f_eyebrow = font("seguisb.ttf", 13)
f_eq = font("cambria.ttc", 26)
f_eq_sub = font("cambria.ttc", 17)
f_small = font("cambria.ttc", 20)
f_small_sub = font("cambria.ttc", 13)
f_gloss = font("segoeui.ttf", 15)
f_lbl = font("seguisb.ttf", 13)
f_sect = font("seguisb.ttf", 15)

TOK = re.compile(r"(_\{[^}]*\}|\^\{[^}]*\})")


def eq_width(text, fnt, sub):
    w = 0.0
    for seg in TOK.split(text):
        if not seg:
            continue
        w += sub.getlength(seg[2:-1]) if seg[:2] in ("_{", "^{") else fnt.getlength(seg)
    return w


def draw_eq(dr, x, y, text, fnt, sub, fill):
    """Typeset one formula: base glyphs, real subscripts and superscripts."""
    size = fnt.size
    for seg in TOK.split(text):
        if not seg:
            continue
        if seg.startswith("_{"):
            dr.text((x, y + size * 0.36), seg[2:-1], font=sub, fill=fill)
            x += sub.getlength(seg[2:-1])
        elif seg.startswith("^{"):
            dr.text((x, y - size * 0.18), seg[2:-1], font=sub, fill=fill)
            x += sub.getlength(seg[2:-1])
        else:
            dr.text((x, y), seg, font=fnt, fill=fill)
            x += fnt.getlength(seg)
    return x


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


def wrap(text, fnt, width):
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


def fmt(v):
    return f"{v:.4f}".rstrip("0").rstrip(".")


w1, w2, w3, w4 = (fmt(w) for w in WEIGHTS)

# Each step: (eyebrow, rows, gloss). A row is a list of formula chunks
# (packed left to right, never broken inside), or a string starting "·"
# for a smaller note line that may wrap by words.
SECTIONS = [
    ("THE LEAGUE'S PLAY",
     [["y  =  μ_{c}( down, distance, field )  +  ε"],
      "·c ∈ { rush, pass }",
      "·distance:  short ≤ 3 · medium ≤ 7 · long",
      "·field:  own deep ≥ 80 · own ≥ 60 · midfield ≥ 40 · opponent ≥ 20 · red zone"],
     "Every snap begins as the league's average outcome for its call and "
     "situation. Yardage is drawn from the measured distribution of that "
     "cell, corrected for the touchdowns that hide how far a play would "
     "have gone."),
    ("WHAT THE TWO TEAMS ADD",
     [["y_{p} − μ_{c}  =  off_{c}[ o ]  −  def_{c}[ d ]  +  ε_{p}"],
      [f"min  Σ_{{p}} ( y_{{p}} − μ_{{c}} − off_{{c}}[ o ] + def_{{c}}[ d ] )^{{2}}  +  λ ( ‖off_{{c}}‖^{{2}} + ‖def_{{c}}‖^{{2}} )", f"λ = {LAM}"]],
     "Solved jointly for every team on every play of the season so far, "
     "separately for rush and pass. Beating a bad defense counts for less "
     "because that defense's rating absorbs its share in the same solve. "
     "Opponents outside FBS are pooled as one team."),
    ("BEFORE A SNAP IS PLAYED",
     [["r_{0}  =  m  +  s · ( β · x  −  m )",
       "x = [ r_{2025} , returning production , portal in , portal out , draft losses , talent ]"],
      [f"r_{{0}}  ←  ½ r_{{0}}  +  ½ · f( talent, recruiting )", "restored to the spread of realised ratings 2015–2025", f"× {PRIOR_SCALE}"]],
     "The preseason prior is who they have, fitted on 2015 to 2025. A "
     "regression compresses, so both halves are stretched back to the "
     "range real ratings show."),
    ("THE RATING AS OF WEEK N",
     [["r_{N}  =  w_{N} · r_{0}  +  ( 1 − w_{N} ) · restore( ridge_{N} )", "r′ = m + ( r − m ) · σ_{target} / σ"],
      f"·w_{{N}} = {w1} · {w2} · {w3} · {w4}   for weeks 1 · 2–3 · 4–10 · 11+"],
     "The rule the backtest was run on. The season's own plays take over "
     "as it lengthens, and each unit rating is rescaled to the spread of "
     "realised full-season ratings before it is blended."),
    ("THE MATCHUP ON THE FIELD",
     [["m_{h}  =  off_{c}[ h ] − def_{c}[ a ]", "m_{a}  =  off_{c}[ a ] − def_{c}[ h ]", "mid = ( m_{h} + m_{a} ) / 2"],
      [f"m̃_{{h}}  =  mid  +  {fmt(MEAN_SCALE)} · ( m_{{h}} − m_{{a}} ) / 2", f"m̃_{{a}}  =  mid  −  {fmt(MEAN_SCALE)} · ( m_{{h}} − m_{{a}} ) / 2"],
      [f"m̃  ←  m̃  +  ε_{{g}}", f"ε_{{g}} ~ N( 0 , {fmt(GAME_SIGMA)}^{{2}} )", "one draw per game"]],
     f"The difference between the sides is stretched by {fmt(MEAN_SCALE)} and "
     "their sum left alone, so the margin gets its range without the total "
     "drifting. One game-level draw is what makes a good team's bad day "
     "possible."),
    ("THE COACH",
     [["P( pass )  =  σ( logit P_{league}( situation )  +  b )", "b → b_{rz}  inside the 20"],
      ["P( go on 4th )  =  σ( logit P_{league}( go )  +  a )", "punts and kicks keep the league's split"],
      ["seconds per snap  =  league( play, phase )  +  pace", "floor 4 s, normal flow only"]],
     "Four measured tendencies of the head coach, each an offset from the "
     "league in the same spot: pass lean, red-zone lean, fourth-down "
     "aggression, tempo. A first-year coach is the league average."),
    ("THE PLAY",
     [["event  ~  cell mix · IM", "IM = int_{off} × int_{def}"],
      ["bump  =  m̃ · n_{all} / n_{gaining}", "P( score )  =  s( y_{tg} ) · ( 1 + clamp( 0.16 · bump , −0.6 , 1.5 ) )"],
      ["yards  =  draw( cell ) + bump", "≤ y_{tg} − 1 unless it scores", "sacks ≤ 0"]],
     "The matchup edge lands only on plays that carry yards, and it lands "
     "additively: an incompletion cannot gain 0.4 yards because the "
     "offense is good."),
    ("EVERYTHING ELSE, MEASURED LEAGUE-WIDE",
     ["·penalties by down:  5.7 · 5.6 · 7.5 · 6.2% of snaps, each down with its own offense share and automatic first downs",
      "·field goals:  P( make | exact yard line ), 23,705 attempts 2019–25",
      "·punt nets and kickoff starts drawn from their distributions  ·  conversions after touchdowns",
      "·end-of-half kicks on downs 1–3  ·  victory formation  ·  bleed the clock, then kick  ·  overtime"],
     "None of this knows which teams are playing. It is identical for "
     "both sides in every game."),
    (f"THE GAME, {NSIM:,} TIMES",
     [["M_{i}  =  home_{i} − away_{i}", "T_{i}  =  home_{i} + away_{i}", f"i = 1 … {NSIM:,}", "seeded by season : week : game"],
      [f"margin  =  mean( M )  +  {fmt(HFA)}", "total  =  mean( T )"]],
     f"Home field is added once, after a neutral simulation. The histograms "
     "and the minute-by-minute path on every game page are these "
     f"{NSIM:,} games. Team power ratings run each team against a "
     f"league-average opponent on a neutral field, {TEAM_NSIM:,} times."),
    ("THE VOTE",
     [["spread edge  =  | margin − market spread |", "total edge  =  | total − market total |"],
      [f"fires  ⇔  spread edge ≥ {fmt(FIRE_EDGE)}  and  total edge ≥ {fmt(FIRE_EDGE)}"],
      ["agrees with the four models → A+", "opposes → No Edge", "fires alone → C"]],
     "Judged at the live-first line, the same number the four models see. "
     "The engine votes on the spread only, both gates have to be open for "
     "it to speak, and the grade of record is set at release."),
]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = args[0] if args else ("engine_formula_ink.png" if DARK else "engine_formula.png")
    img = Image.new("RGB", (Wd, 6800 * S), BG)
    dr = ImageDraw.Draw(img)

    lp = os.path.join(ROOT, P["LOGO"])
    logo = lmask = None
    if os.path.exists(lp):
        logo = Image.open(lp).convert("RGB")
        h_ = 74 * S
        logo = logo.resize((int(logo.width * h_ / logo.height), h_), Image.LANCZOS)
        if DARK:
            lmask = logo.convert("L").point(lambda v: int(255 * (v / 255.0) ** 0.5))

    y = 44 * S
    if logo:
        img.paste(logo, (PAD, y), lmask)
    track(dr, (Wd - PAD, y + 30 * S), "THE ENGINE", f_sect, TEXT_SOFT, 15, anchor="r")
    y += 92 * S
    dr.rectangle([PAD, y, Wd - PAD, y + 1 * S], fill=RULE)
    y += 36 * S
    dr.text((PAD, y), "Every game, one play at a time.", font=f_title, fill=TEXT)
    y += 72 * S
    for ln in wrap("How the Monte Carlo engine turns a season of plays into a projection: "
                   "ten steps in the order a simulation runs them, with every constant "
                   "as it stands in production today.", f_deck, Wd - 2 * PAD):
        dr.text((PAD, y), ln, font=f_deck, fill=TEXT_SOFT)
        y += 27 * S
    y += 26 * S

    x0 = PAD + IND
    cw = Wd - PAD - x0
    for i, (eyebrow, rows, gloss) in enumerate(SECTIONS, 1):
        dr.rectangle([PAD, y, Wd - PAD, y + 1 * S], fill=RULE)
        y += 26 * S
        dr.text((PAD, y - 4 * S), f"{i:02d}", font=f_num, fill=ACCENT)
        track(dr, (x0, y + 8 * S), eyebrow, f_eyebrow, ACCENT_TEXT, 13)
        y += 50 * S
        for row in rows:
            if isinstance(row, str):                      # a smaller note line
                text = row[1:]
                for ln in wrap(text, f_small, cw):
                    draw_eq(dr, x0, y, ln, f_small, f_small_sub, TEXT_SOFT)
                    y += 30 * S
                continue
            # pack formula chunks left to right; a chunk that will not fit
            # starts a new line; a chunk wider than the column gets its own
            line, x = [], x0
            for ch in row:
                w = eq_width(ch, f_eq, f_eq_sub)
                if line and x + w > Wd - PAD:
                    for cx, ctext in line:
                        draw_eq(dr, cx, y, ctext, f_eq, f_eq_sub, TEXT)
                    y += 42 * S
                    line, x = [], x0
                line.append((x, ch))
                x += w + GAP
            for cx, ctext in line:
                draw_eq(dr, cx, y, ctext, f_eq, f_eq_sub, TEXT)
            y += 42 * S
        y += 4 * S
        for ln in wrap(gloss, f_gloss, cw):
            dr.text((x0, y), ln, font=f_gloss, fill=MUTED)
            y += 24 * S
        y += 26 * S

    dr.rectangle([PAD, y, Wd - PAD, y + 3 * S], fill=ACCENT)
    y += 24 * S
    track(dr, (PAD, y), "PRESSBOXANALYTICS.COM", f_lbl, ACCENT_TEXT, 13)
    track(dr, (Wd - PAD, y), f"SIM_ENGINE2 · {W.MODEL_VERSION.split('/')[1].upper()} · READ FROM THE CODE",
          f_lbl, MUTED, 13, anchor="r")
    bot = y + 40 * S
    img.crop((0, 0, Wd, bot)).save(out, "PNG")
    print(f"wrote {out}  ({Wd}x{bot})")


if __name__ == "__main__":
    main()

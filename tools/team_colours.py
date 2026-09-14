# -*- coding: utf-8 -*-
"""One team-colour table, shared by every card.

There were two copies of this dict -- one in game_projection_card.py and
one in game_flow_card.py -- and teams got added to the flow card only.
The result was a matched pair of cards where the flow chart used real
team colours and the projection card fell back to Missouri gold and
Kansas blue for five of seven games. A single table is the fix; import
it, never re-declare it.

Colours are each school's primary, in the sign they would print. Dark
ones are lifted at render time (see `readable` in the cards) rather than
being pre-lightened here, so the same values serve the cream theme too.
"""

TEAM_COLOUR = {
    # Big Ten
    "Michigan": (0, 39, 76), "Ohio State": (187, 0, 0),
    "Penn State": (4, 30, 66), "Michigan State": (24, 69, 59),
    "Wisconsin": (197, 5, 12), "Iowa": (0, 0, 0),
    "Minnesota": (122, 0, 25), "Nebraska": (208, 0, 0),
    "Illinois": (232, 74, 39), "Indiana": (153, 0, 0),
    "Purdue": (206, 184, 136), "Northwestern": (78, 42, 132),
    "Maryland": (224, 58, 62), "Rutgers": (204, 0, 51),
    "Oregon": (0, 79, 57), "Washington": (51, 0, 111),
    "UCLA": (39, 116, 174), "USC": (153, 27, 30),
    # SEC
    "Alabama": (158, 27, 50), "Georgia": (186, 12, 47),
    "LSU": (70, 29, 124), "Texas": (191, 87, 0),
    "Oklahoma": (132, 22, 23), "Tennessee": (255, 130, 0),
    "Florida": (0, 33, 165), "Auburn": (12, 35, 64),
    "Texas A&M": (80, 0, 0), "Missouri": (241, 184, 45),
    "Arkansas": (157, 34, 53), "Kentucky": (0, 51, 160),
    "South Carolina": (115, 0, 10), "Mississippi State": (95, 21, 39),
    "Ole Miss": (20, 32, 62), "Vanderbilt": (134, 109, 75),
    # Big 12
    "Kansas": (0, 81, 186), "Kansas State": (81, 40, 136),
    "Iowa State": (200, 32, 42), "Oklahoma State": (255, 103, 0),
    "Baylor": (21, 71, 52), "TCU": (77, 25, 121),
    "Texas Tech": (204, 0, 0), "Utah": (204, 0, 0),
    "BYU": (0, 47, 108), "Arizona": (0, 51, 102),
    "Arizona State": (140, 29, 64), "Colorado": (207, 184, 124),
    "Cincinnati": (0, 0, 0), "Houston": (200, 16, 46),
    "UCF": (186, 155, 55), "West Virginia": (0, 39, 76),
    "Kansas St": (81, 40, 136), "Washington State": (152, 30, 50),
    # ACC
    "Clemson": (245, 102, 0), "Florida State": (120, 47, 64),
    "Miami": (240, 129, 32), "North Carolina": (123, 175, 212),
    "NC State": (204, 0, 0), "Duke": (0, 48, 135),
    "Virginia": (35, 45, 75), "Virginia Tech": (99, 0, 49),
    "Louisville": (173, 0, 62), "Pittsburgh": (0, 50, 98),
    "Syracuse": (212, 69, 0), "Boston College": (152, 30, 50),
    "Wake Forest": (158, 126, 56), "Georgia Tech": (179, 163, 105),
    "California": (0, 50, 98), "Stanford": (140, 21, 21),
    "SMU": (100, 74, 161), "Notre Dame": (12, 35, 64),
    # others that have come up
    "Boise State": (0, 51, 102), "Memphis": (0, 51, 102),
    "Marshall": (0, 178, 122), "Troy": (140, 25, 44),
    "Sam Houston": (255, 129, 0), "Hawai'i": (0, 61, 76),
    "North Texas": (0, 133, 63), "Ball State": (186, 12, 47),
    "Coastal Carolina": (0, 107, 140), "UAB": (30, 107, 82),
    "East Carolina": (89, 44, 136), "Arkansas State": (204, 8, 51),
    "Liberty": (0, 33, 71), "James Madison": (69, 0, 132),
    "Nevada": (0, 26, 68), "Western Kentucky": (255, 100, 0),
    "Miami (OH)": (197, 18, 48), "Western Michigan": (110, 85, 42),
    "Texas State": (80, 26, 42), "Penn State": (4, 30, 66),
    "Massachusetts": (136, 21, 42), "Missouri State": (110, 38, 14),
    "Temple": (156, 20, 36), "UConn": (0, 14, 47),
    "Georgia Southern": (0, 32, 91), "Oregon State": (220, 68, 5),
    "Utah State": (0, 38, 53), "Colorado State": (30, 77, 43),
}


# Real SECONDARY colours, used only when two teams' primaries are too
# close to tell apart in a chart. Blending a primary toward cream to
# separate it desaturates it into pink -- Arizona State and Arkansas
# both came out pink that way -- so reach for a colour the school
# actually wears before distorting the one it leads with.
TEAM_SECONDARY = {
    "Arizona State": (255, 198, 39),     # gold
    "Michigan": (255, 203, 5),           # maize
    "Iowa": (255, 205, 0),               # gold
    "Iowa State": (241, 190, 72),        # gold
    "Georgia Tech": (0, 48, 87),         # navy
    "Oregon": (254, 225, 35),            # yellow
    "LSU": (253, 208, 35),               # gold
    "Missouri": (0, 0, 0),               # black
    "Washington": (232, 211, 162),       # gold
    "West Virginia": (234, 106, 32),     # gold
    "Pittsburgh": (255, 183, 28),        # gold
    "Wake Forest": (0, 0, 0),            # black
    "Navy": (212, 175, 55),
    "Baylor": (255, 184, 28),            # gold
    "Boston College": (185, 151, 91),    # gold
    "Florida State": (206, 184, 136),    # gold
    "Tennessee": (88, 89, 91),
    "Arkansas": (83, 86, 90),            # anthracite
    "Alabama": (130, 138, 143),
}
# White is a real secondary for plenty of schools and a terrible chart
# fill -- a white area on an ink card glares -- so it is deliberately
# absent above. A team with only white to fall back on gets the
# multiply instead.


def resolve_pair(away, home, fallback_away, fallback_home,
                 dark, bg, floor=95, sep=110):
    """Colours for two teams, legible on `bg` and tellable apart.

    ONE implementation for both cards: they had separate copies and the
    projection card ended up drawing Arizona State in maroon while its
    own flow card drew them in gold.

    Lift only as far as the background requires -- a flat lift turned
    Michigan navy to slate. To separate two that collide, prefer the
    team's REAL secondary, then a multiply (darkens while holding hue,
    so two reds at different values still read as two reds), and only
    then a lift, which desaturates and is what made Arizona State and
    Arkansas come out pink.
    """
    def d(x, y):
        return sum((p - q) ** 2 for p, q in zip(x, y)) ** 0.5

    def lift(c, amt):
        return tuple(int(round(v + (248 - v) * amt)) for v in c)

    def shade(c, f):
        return tuple(max(0, min(255, int(round(v * f)))) for v in c)

    def readable(c):
        if not dark:
            return c
        n = 0
        while d(c, bg) < floor and n < 12:
            c = lift(c, 0.05)
            n += 1
        return c

    a = TEAM_COLOUR.get(away)
    h = TEAM_COLOUR.get(home)
    a = fallback_away if a is None else readable(a)
    h = fallback_home if h is None else readable(h)
    if d(a, h) >= sep:
        return a, h
    for who, is_home in ((home, True), (away, False)):
        sec = TEAM_SECONDARY.get(who)
        if not sec:
            continue
        sec = readable(sec)
        if is_home and d(a, sec) >= sep:
            return a, sec
        if not is_home and d(sec, h) >= sep:
            return sec, h
    dark_home = sum(h) <= sum(a)
    for f in (0.76, 0.62, 0.50):
        cand = (a, shade(h, f)) if dark_home else (shade(a, f), h)
        moved = cand[1] if dark_home else cand[0]
        if d(*cand) >= sep and d(moved, bg) >= 68:
            return cand
    for amt in (0.30, 0.45, 0.60):
        h2 = lift(h, amt)
        if d(a, h2) >= sep:
            return a, h2
    return a, lift(h, 0.60)

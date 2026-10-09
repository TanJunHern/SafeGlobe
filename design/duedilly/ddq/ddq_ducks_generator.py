"""DDQ duck pack: mommy duck (the questionnaire), ducklings (sections), ugly duckling (badly filled)."""
import os
import cairosvg

OUT = "/tmp/ddq_ducks"
os.makedirs(OUT, exist_ok=True)

C = dict(ink="#3A3541", body="#F6DD8E", wing="#E9C873", bill="#EE8B3A", pale="#FFF6DC",
         ugly="#B9AE9C", ugly_wing="#A3977F", ugly_bill="#D69A62", empty="#B9B2A6",
         water="#7FB8B3", teal="#1F6F6B", bg="#FBF6E9", muted="#6B6573", card="#FFFFFF",
         flag="#E0A23A", ok="#6E9F6A")
SW = 2.6

D_BODY = ("M 8 31 C 12 34 16 33 20 30 C 27 27 41 27 48 31 C 55 35 53 46 45 48 "
          "C 37 50 22 50 16 46 C 11 43 9 38 8 31 Z")
D_WING = "M 21 36 C 26 33 34 33 38 36 C 35 41 26 42 21 36 Z"
D_BILL = "M 50 19.5 C 56 18.5 60.5 20.5 59.5 23.5 C 58.5 26 54 26 50.5 25 Z"


def duckling(body=None, wing=None, bill=None, uid="d", fill_frac=1.0, dashed=False, tuft=True):
    body = body or C["body"]; wing = wing or C["wing"]; bill = bill or C["bill"]
    s = []
    if dashed:
        st = f'stroke="{C["empty"]}" stroke-width="{SW}" stroke-dasharray="3.5 3" fill="{C["pale"]}"'
        s.append(f'<path d="{D_BODY}" {st} stroke-linejoin="round"/>')
        s.append(f'<circle cx="42" cy="22" r="10" {st}/>')
        s.append(f'<path d="{D_BILL}" {st} stroke-linejoin="round"/>')
        return "".join(s)
    if fill_frac < 1:
        # in progress: pale duckling, filled from the bottom up
        cut = 50 - (50 - 12) * fill_frac
        s.append(f'<defs><clipPath id="{uid}"><rect x="0" y="{cut:.1f}" width="64" height="64"/></clipPath></defs>')
        for f, clip in ((C["pale"], ""), (body, f' clip-path="url(#{uid})"')):
            s.append(f'<g{clip}><path d="{D_BODY}" fill="{f}"/><circle cx="42" cy="22" r="10" fill="{f}"/></g>')
        s.append(f'<path d="{D_BODY}" fill="none" stroke="{C["ink"]}" stroke-width="{SW}" stroke-linejoin="round"/>')
        s.append(f'<circle cx="42" cy="22" r="10" fill="none" stroke="{C["ink"]}" stroke-width="{SW}"/>')
    else:
        s.append(f'<path d="{D_BODY}" fill="{body}" stroke="{C["ink"]}" stroke-width="{SW}" stroke-linejoin="round"/>')
        s.append(f'<path d="{D_WING}" fill="{wing}" stroke="{C["ink"]}" stroke-width="2" stroke-linejoin="round"/>')
        s.append(f'<circle cx="42" cy="22" r="10" fill="{body}" stroke="{C["ink"]}" stroke-width="{SW}"/>')
    if tuft:
        s.append(f'<path d="M 41 13 C 40 8 45 6 46 10" fill="none" stroke="{C["ink"]}" stroke-width="2.2" stroke-linecap="round"/>')
    s.append(f'<path d="{D_BILL}" fill="{bill}" stroke="{C["ink"]}" stroke-width="2.2" stroke-linejoin="round"/>')
    s.append(f'<circle cx="45" cy="20" r="2" fill="{C["ink"]}"/>')
    return "".join(s)


def ugly():
    s = []
    # stray feather floating behind
    s.append(f'<path d="M 10 12 C 16 8 22 10 22 14 C 18 16 13 16 10 12 Z" fill="{C["ugly"]}" stroke="{C["ink"]}" stroke-width="1.6" stroke-linejoin="round" transform="rotate(-20 16 12)"/>')
    s.append(f'<path d="M 9 13 L 4 17" stroke="{C["ink"]}" stroke-width="1.6" stroke-linecap="round"/>')
    # ruffled back spikes (drawn before body so the body covers their base)
    for x, h, tilt in ((24, 6, -12), (31, 7, 4), (37, 5, 14), (14, 5, -24)):
        s.append(f'<path d="M {x-3} 31 L {x} {29-h} L {x+3} 31 Z" fill="{C["ugly"]}" stroke="{C["ink"]}" stroke-width="2" '
                 f'stroke-linejoin="round" transform="rotate({tilt} {x} 31)"/>')
    s.append(f'<path d="{D_BODY}" fill="{C["ugly"]}" stroke="{C["ink"]}" stroke-width="{SW}" stroke-linejoin="round"/>')
    s.append(f'<path d="M 21 36 C 26 34 34 35 37 39 C 33 42 26 42 21 36 Z" fill="{C["ugly_wing"]}" stroke="{C["ink"]}" stroke-width="2" stroke-linejoin="round"/>')
    s.append(f'<path d="M 26 39 L 24 43 M 31 40 L 30 44" stroke="{C["ink"]}" stroke-width="1.6" stroke-linecap="round"/>')
    s.append(f'<circle cx="42" cy="23" r="10" fill="{C["ugly"]}" stroke="{C["ink"]}" stroke-width="{SW}"/>')
    # messy tuft
    for d in ("M 39 14 C 36 8 38 5 40 6", "M 42 13 C 43 7 47 6 47 9", "M 45 14 C 49 11 51 13 50 15"):
        s.append(f'<path d="{d}" fill="none" stroke="{C["ink"]}" stroke-width="2" stroke-linecap="round"/>')
    s.append(f'<path d="M 50 21.5 C 55 21 59 22.5 58.5 25 C 57.5 27 53 27 50.5 26 Z" fill="{C["ugly_bill"]}" stroke="{C["ink"]}" stroke-width="2.2" stroke-linejoin="round"/>')
    s.append(f'<circle cx="45" cy="21" r="2" fill="{C["ink"]}"/>')
    s.append(f'<path d="M 42 16.5 L 47.5 18" stroke="{C["ink"]}" stroke-width="1.8" stroke-linecap="round"/>')
    return "".join(s)


M_BODY = ("M 3 30 C 8 34 13 33 18 29 C 27 25 44 25 52 30 C 59 35 57 47 48 49 "
          "C 38 51 20 51 13 47 C 7 43 4 37 3 30 Z")


def mommy(envelope=False, water=False):
    s = []
    if water:
        s.append(f'<path d="M 1 53 Q 6 50 11 53 T 21 53 T 31 53 T 41 53 T 51 53 T 61 53" fill="none" stroke="{C["water"]}" stroke-width="2" stroke-linecap="round"/>')
    s.append(f'<path d="M 41 33 C 40 25 42 18 46 15 L 53.5 17 C 51 22 51 27 53 33 Z" fill="{C["body"]}" stroke="{C["ink"]}" stroke-width="2.4" stroke-linejoin="round"/>')
    s.append(f'<path d="{M_BODY}" fill="{C["body"]}" stroke="{C["ink"]}" stroke-width="2.4" stroke-linejoin="round"/>')
    s.append(f'<path d="M 19 35 C 25 31 37 31 42 35 C 38 41 26 42 19 35 Z" fill="{C["wing"]}" stroke="{C["ink"]}" stroke-width="1.9" stroke-linejoin="round"/>')
    s.append(f'<circle cx="49" cy="14" r="7.5" fill="{C["body"]}" stroke="{C["ink"]}" stroke-width="2.4"/>')
    s.append(f'<path d="M 55 12 C 59.5 11 63 12.5 62.5 15 C 62 17 58.5 17.5 55.5 16.5 Z" fill="{C["bill"]}" stroke="{C["ink"]}" stroke-width="2" stroke-linejoin="round"/>')
    s.append(f'<circle cx="51" cy="12" r="1.7" fill="{C["ink"]}"/>')
    if envelope:
        s.append(f'<g transform="rotate(-12 60 20)"><rect x="54" y="16" width="10" height="7.5" rx="1.2" fill="{C["card"]}" stroke="{C["ink"]}" stroke-width="1.6"/>'
                 f'<path d="M 54.5 16.8 L 59 20.5 L 63.5 16.8" fill="none" stroke="{C["ink"]}" stroke-width="1.3" stroke-linejoin="round"/></g>')
    return "".join(s)


def tick(cx, cy, r, color):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}" stroke="#FFFFFF" stroke-width="{r*0.25:.1f}"/>'
            f'<path d="M {cx-r*0.45:.1f} {cy} L {cx-r*0.1:.1f} {cy+r*0.35:.1f} L {cx+r*0.5:.1f} {cy-r*0.4:.1f}" fill="none" stroke="#FFFFFF" stroke-width="{r*0.28:.1f}" stroke-linecap="round" stroke-linejoin="round"/>')


def bang(cx, cy, r, color):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}" stroke="#FFFFFF" stroke-width="{r*0.25:.1f}"/>'
            f'<path d="M {cx} {cy-r*0.5:.1f} L {cx} {cy+r*0.1:.1f}" stroke="#FFFFFF" stroke-width="{r*0.28:.1f}" stroke-linecap="round"/>'
            f'<circle cx="{cx}" cy="{cy+r*0.45:.1f}" r="{r*0.15:.1f}" fill="#FFFFFF"/>')


STATES = {
    "duckling_done": lambda: duckling() + tick(52, 44, 8, C["ok"]),
    "duckling_in_progress": lambda: duckling(uid="ip", fill_frac=0.5),
    "duckling_not_started": lambda: duckling(dashed=True, tuft=False),
    "ugly_duckling": lambda: ugly() + bang(52, 44, 8, C["flag"]),
    "duckling_plain": lambda: duckling(),
    "ugly_duckling_plain": lambda: ugly(),
}


def nested(x, y, size, inner, flip=False):
    tr = ' transform="translate(64 0) scale(-1 1)"' if flip else ""
    return f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 64 64"><g{tr}>{inner}</g></svg>'


def svg(inner, w=64, h=64, size=None):
    size = size or w
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{size}" height="{size*h/w:.0f}">{inner}</svg>'


def text(x, y, t, size=16, weight=400, fill=None, anchor="start"):
    return (f'<text x="{x}" y="{y}" font-family="Inter" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill or C["ink"]}" text-anchor="{anchor}">{t}</text>')


def progress_row(states, mommy_env=False):
    """Mommy duck leads on the right; ducklings follow to the left. Returns inner SVG (width 64*(n+1.6))."""
    n = len(states)
    W = 64 * (n + 1.7)
    g = [f'<path d="M 0 58 Q 8 55 16 58 ' + " ".join(f"T {16+16*k} 58" for k in range(1, int(W/16))) +
         f'" fill="none" stroke="{C["water"]}" stroke-width="2" stroke-linecap="round" opacity=".7"/>']
    for i, st in enumerate(states):
        x = i * 64
        g.append(nested(x, 6, 58, STATES[st]()))
    g.append(nested(n * 64 + 2, -14, 100, mommy(envelope=mommy_env)))
    return "".join(g), W


def sheet():
    W, H = 1600, 1180
    g = [f'<rect width="{W}" height="{H}" fill="{C["bg"]}"/>']
    g.append(text(64, 92, "DDQ ducks", 56, 800))
    g.append(text(64, 128, "DueDilly questionnaire pack  ·  mommy duck = the DDQ, ducklings = its sections", 20, 500, C["muted"]))

    def panel(x, y, w, h):
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="22" fill="#FFFDF7" stroke="#EADFC4" stroke-width="2"/>'

    cast = [
        ("mommy", lambda: mommy(), "Mommy duck", "The DDQ itself. Draft / header"),
        ("mommy_env", lambda: mommy(envelope=True), "Mommy + envelope", "DDQ sent (Quack-Back)"),
        ("duckling_done", STATES["duckling_done"], "Duckling, done", "Section complete"),
        ("duckling_in_progress", STATES["duckling_in_progress"], "Duckling, filling up", "Section in progress"),
        ("duckling_not_started", STATES["duckling_not_started"], "Duckling, outline", "Section not started"),
        ("ugly_duckling", STATES["ugly_duckling"], "Ugly duckling", "Section needs another look"),
    ]
    for i, (_, fn, name, use) in enumerate(cast):
        x = 64 + i * 248
        g.append(panel(x, 160, 228, 290))
        g.append(nested(x + 34, 186, 160, fn()))
        g.append(text(x + 114, 398, name, 18, 700, anchor="middle"))
        g.append(text(x + 114, 424, use, 14, 500, C["muted"], anchor="middle"))

    # progress examples
    g.append(panel(64, 474, 1472, 470))
    g.append(text(94, 518, "Progress row: one duckling per DDQ section, following mommy", 22, 700))
    ex = [
        (["duckling_not_started"] * 7, False, "Just opened", "0 of 7 sections"),
        (["duckling_done"] * 3 + ["duckling_in_progress"] + ["duckling_not_started"] * 3, False, "Filling in", "3 of 7 done, section 4 in progress"),
        (["duckling_done"] * 4 + ["ugly_duckling"] + ["duckling_done"] * 2, False, "Needs attention", "Section 5 has gaps or inconsistent answers"),
        (["duckling_done"] * 7, True, "All ducks in a row", "Every section complete, ready to submit"),
    ]
    for i, (states, env, title, sub) in enumerate(ex):
        y = 548 + i * 98
        inner, rw = progress_row(states[::-1], env)
        scale = 0.92
        g.append(f'<g transform="translate(94 {y}) scale({scale})">{inner}</g>')
        g.append(text(94 + rw * scale + 36, y + 42, title, 18, 700))
        g.append(text(94 + rw * scale + 36, y + 66, sub, 15, 500, C["muted"]))

    # copy guidance
    g.append(panel(64, 968, 1472, 180))
    g.append(text(94, 1010, "Wording", 22, 700))
    rows = [
        ("Supplier sees (DDQ portal)", "Ugly duckling + \"A few answers need another look before you submit.\" Never call their DDQ ugly."),
        ("Reviewer sees (Reviews, DDQ)", "Ugly duckling label: \"Poorly completed\", with the list of failed checks per section."),
        ("All ducks in a row", "Submit button unlocks. \"All 7 sections complete. Ready to submit.\""),
    ]
    for i, (a, b) in enumerate(rows):
        yy = 1046 + i * 34
        g.append(f'<circle cx="100" cy="{yy-6}" r="4" fill="{C["teal"]}"/>')
        g.append(text(114, yy, a, 16, 700))
        g.append(text(400, yy, b, 16, 500))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">{"".join(g)}</svg>'


if __name__ == "__main__":
    s = sheet()
    open(f"{OUT}/ddq_ducks_sheet.svg", "w").write(s)
    cairosvg.svg2png(bytestring=s.encode(), write_to=f"{OUT}/ddq_ducks_sheet.png", output_width=2400)
    cairosvg.svg2png(bytestring=s.encode(), write_to="/tmp/ddq_preview.png", output_width=1400)
    files = {name: fn() for name, fn in STATES.items()}
    files["mommy_duck"] = mommy()
    files["mommy_duck_envelope"] = mommy(envelope=True)
    for name, inner in files.items():
        d = svg(inner)
        open(f"{OUT}/{name}.svg", "w").write(d)
        cairosvg.svg2png(bytestring=d.encode(), write_to=f"{OUT}/{name}.png", output_width=256)
    for key, (states, env) in {"all_in_a_row": (["duckling_done"] * 7, True),
                               "needs_attention": (["duckling_done"] * 4 + ["ugly_duckling"] + ["duckling_done"] * 2, False)}.items():
        inner, rw = progress_row(states[::-1], env)
        d = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -16 {rw:.0f} 92" width="{rw*3:.0f}" height="276">{inner}</svg>'
        open(f"{OUT}/banner_{key}.svg", "w").write(d)
        cairosvg.svg2png(bytestring=d.encode(), write_to=f"{OUT}/banner_{key}.png")
    print("done")

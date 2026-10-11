"""Duckling icons that replace vessel icons in DueDilly. 64x64 grid, Dilly v3 style."""
import os
import cairosvg

OUT = "/tmp/dilly3/ducklings"
os.makedirs(OUT, exist_ok=True)

C = dict(ink="#3A3541", body="#F6DD8E", belly="#FFF6DC", bill="#EE8B3A", water="#7FB8B3",
         bg="#FBF6E9", muted="#6B6573", dark_bg="#1F1E23", dark_body="#CFC6B2",
         escalate="#D9604F", investigate="#E0A23A", clear="#6E9F6A", dark="#8C8794")

# side view, facing right (direction of travel)
BODY = ("M 8 31 C 12 34 16 33 20 30 C 27 27 41 27 48 31 C 55 35 53 46 45 48 "
        "C 37 50 22 50 16 46 C 11 43 9 38 8 31 Z")


def duckling(fill=None, water=True, sw=2.6):
    f = fill or C["body"]
    s = []
    if water:
        s.append(f'<path d="M 3 50 Q 8 47 13 50 T 23 50 T 33 50 T 43 50 T 53 50 T 61 50" fill="none" '
                 f'stroke="{C["water"]}" stroke-width="2.4" stroke-linecap="round"/>')
        s.append(f'<path d="M 2 39 L 7 39 M 0 44 L 6 44" stroke="{C["water"]}" stroke-width="2.2" stroke-linecap="round"/>')
    s.append(f'<path d="{BODY}" fill="{f}" stroke="{C["ink"]}" stroke-width="{sw}" stroke-linejoin="round"/>')
    s.append(f'<path d="M 21 36 C 26 33 34 33 38 36 C 35 41 26 42 21 36 Z" fill="#E9C873" stroke="{C["ink"]}" stroke-width="{sw*0.75:.1f}" stroke-linejoin="round"/>')
    s.append(f'<path d="M 41 13 C 40 8 45 6 46 10" fill="none" stroke="{C["ink"]}" stroke-width="{sw*0.85:.1f}" stroke-linecap="round"/>')
    s.append(f'<circle cx="42" cy="22" r="10" fill="{f}" stroke="{C["ink"]}" stroke-width="{sw}"/>')
    s.append(f'<path d="M 50 19.5 C 56 18.5 60.5 20.5 59.5 23.5 C 58.5 26 54 26 50.5 25 Z" fill="{C["bill"]}" '
             f'stroke="{C["ink"]}" stroke-width="{sw*0.85:.1f}" stroke-linejoin="round"/>')
    s.append(f'<circle cx="45" cy="20" r="2" fill="{C["ink"]}"/>')
    return "".join(s)


def marker(ring, dashed=False, fill=None):
    """Circular map marker, 64x64."""
    da = ' stroke-dasharray="5 4"' if dashed else ""
    return (f'<circle cx="32" cy="32" r="28" fill="#FFFDF7" stroke="{ring}" stroke-width="4"{da}/>'
            f'<g transform="translate(9.5 8) scale(0.7)">{duckling(fill, water=True, sw=3.4)}</g>')


def svg(inner, size=64, vb=64):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}" width="{size}" height="{size}">{inner}</svg>'


def nested(x, y, size, inner):
    return f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 64 64">{inner}</svg>'


def text(x, y, t, size=16, weight=400, fill=None, anchor="start", family="Inter"):
    return (f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill or C["ink"]}" text-anchor="{anchor}">{t}</text>')


MARKERS = [("escalate", C["escalate"], False, None, "Escalate"),
           ("investigate", C["investigate"], False, None, "Investigate"),
           ("clear", C["clear"], False, None, "Auto-clear"),
           ("ais_dark", C["dark"], True, C["dark_body"], "AIS dark / gap")]


def sheet():
    W, H = 1600, 900
    g = [f'<rect width="{W}" height="{H}" fill="{C["bg"]}"/>']
    g.append(text(64, 92, "Ducklings", 56, 800))
    g.append(text(64, 128, "Vessel icons for DueDilly  ·  replaces the ship icon in the watchlist, map and drawer", 20, 500, C["muted"]))

    def panel(x, y, w, h, fill="#FFFDF7"):
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="22" fill="{fill}" stroke="#EADFC4" stroke-width="2"/>'

    # hero
    g.append(panel(64, 160, 440, 420))
    g.append(nested(124, 190, 320, duckling()))
    g.append(text(284, 552, "List icon (faces direction of travel)", 18, 700, anchor="middle"))

    # sizes, light and dark
    g.append(panel(528, 160, 1008, 200))
    g.append(text(558, 202, "Sizes  ·  light", 18, 700))
    sizes = [16, 20, 24, 32, 48]
    x = 560
    for sz in sizes:
        g.append(nested(x, 300 - sz, sz, duckling()))
        g.append(text(x + sz / 2, 336, f"{sz}px", 13, 500, C["muted"], "middle"))
        x += sz + 70
    g.append(f'<rect x="1040" y="182" width="476" height="160" rx="16" fill="{C["dark_bg"]}"/>')
    g.append(text(1062, 214, "Sizes  ·  dark map", 18, 700, "#F2EEE6"))
    x = 1066
    for sz in [16, 24, 32, 48]:
        g.append(nested(x, 300 - sz, sz, duckling()))
        g.append(text(x + sz / 2, 326, f"{sz}px", 13, 500, "#A9A3AE", "middle"))
        x += sz + 64

    # markers
    g.append(panel(528, 380, 1008, 200))
    g.append(text(558, 422, "Map markers, ring = route", 18, 700))
    for i, (key, ring, dashed, fill, label) in enumerate(MARKERS):
        mx = 580 + i * 240
        g.append(nested(mx, 440, 80, marker(ring, dashed, fill)))
        g.append(f'<rect x="{mx+100}" y="452" width="96" height="56" rx="12" fill="{C["dark_bg"]}"/>')
        g.append(nested(mx + 124, 456, 48, marker(ring, dashed, fill)))
        g.append(text(mx + 90, 552, label, 16, 600, anchor="middle"))

    # usage
    g.append(panel(64, 604, 1472, 240))
    g.append(text(94, 648, "How to use them", 22, 700))
    notes = [
        "Watchlist row and drawer header: list icon at 20-24px, in place of the ship icon.",
        "Map: circular marker at 32-40px. Ring colour follows the route (Escalate red, Investigate amber, Auto-clear green).",
        "AIS dark or gap: dashed grey ring and a faded duckling, so missing position data looks different from live data.",
        "Direction: mirror the duckling to face left for courses 180-360 degrees, never rotate it upside down. Exact course goes in the drawer.",
        "Ducklings, not Dilly: vessels and other watched entities are the ducklings Dilly keeps in a row.",
    ]
    for i, n in enumerate(notes):
        g.append(f'<circle cx="100" cy="{681 + i*34}" r="4" fill="#1F6F6B"/>')
        g.append(text(114, 687 + i * 34, n, 16, 500))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">{"".join(g)}</svg>'


if __name__ == "__main__":
    s = sheet()
    open(f"{OUT}/ducklings_sheet.svg", "w").write(s)
    cairosvg.svg2png(bytestring=s.encode(), write_to=f"{OUT}/ducklings_sheet.png", output_width=2400)
    cairosvg.svg2png(bytestring=s.encode(), write_to="/tmp/ducklings_preview.png", output_width=1400)
    files = {"duckling_icon.svg": svg(duckling()),
             "duckling_icon_nowater.svg": svg(duckling(water=False))}
    for key, ring, dashed, fill, _ in MARKERS:
        files[f"duckling_marker_{key}.svg"] = svg(marker(ring, dashed, fill))
    for name, d in files.items():
        open(f"{OUT}/{name}", "w").write(d)
        cairosvg.svg2png(bytestring=d.encode(), write_to=f"{OUT}/{name[:-4]}.png", output_width=256)
    print("done")

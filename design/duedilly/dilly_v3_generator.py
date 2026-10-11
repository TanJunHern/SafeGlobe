"""Dilly v2: soft blob style. One rounded body, thin outline, flat colour, bead eyes."""
import os
import cairosvg

OUT = "/tmp/dilly3"
os.makedirs(OUT, exist_ok=True)

C = dict(ink="#3A3541", body="#F6DD8E", belly="#FFF6DC", shade="#E9C873",
         bill="#EE8B3A", bill_dk="#C9662A", mouth="#8A3A1C", teal="#1F6F6B",
         teal_lt="#A9CFCB", card="#FFFFFF", line="#C8D5D3", bg="#FBF6E9",
         muted="#6B6573", drop="#9CCBE0")
LW = 4  # thin outline

BODY = ("M 200 74 C 284 74 318 150 326 232 C 333 300 320 352 268 358 "
        "L 132 358 C 80 352 67 300 74 232 C 82 150 116 74 200 74 Z")


def bead(x, y, r=6.8):
    return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="{C["ink"]}"/>'
            f'<circle cx="{x-2.2:.1f}" cy="{y-2.4:.1f}" r="2" fill="#FFFFFF"/>')


def badge(x, y, w=30, h=38):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="{C["card"]}" stroke="{C["ink"]}" stroke-width="3"/>'
            f'<path d="M {x} {y+11} L {x} {y+5} Q {x} {y} {x+5} {y} L {x+w-5} {y} Q {x+w} {y} {x+w} {y+5} L {x+w} {y+11} Z" fill="{C["teal"]}"/>'
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="none" stroke="{C["ink"]}" stroke-width="3"/>'
            f'<circle cx="{x+w/2}" cy="{y+20}" r="5" fill="{C["teal_lt"]}"/>'
            f'<rect x="{x+7}" y="{y+29}" width="{w-14}" height="3" rx="1.5" fill="{C["line"]}"/>')


def dilly(uid, expr="neutral", view="front"):
    """view: front | three (face turned slightly left)."""
    dx = -46 if view == "three" else 0
    s = [f'<defs><clipPath id="{uid}c"><path d="{BODY}"/></clipPath></defs>']
    # tail (behind body)
    tail_x = 0 if view == "front" else 10
    s.append(f'<path d="M {316+tail_x} 312 C {346+tail_x} 312 {360+tail_x} 290 {356+tail_x} 268 '
             f'C {346+tail_x} 284 {334+tail_x} 292 {312+tail_x} 294 Z" fill="{C["body"]}" stroke="{C["ink"]}" '
             f'stroke-width="{LW}" stroke-linejoin="round"/>')
    # body + belly
    s.append(f'<path d="{BODY}" fill="{C["body"]}"/>')
    s.append(f'<g clip-path="url(#{uid}c)">'
             f'<ellipse cx="{200+dx*0.6}" cy="282" rx="96" ry="84" fill="{C["belly"]}"/>'
             f'<path d="M 300 120 C 330 180 336 280 318 352 L 360 360 L 360 100 Z" fill="{C["shade"]}" opacity=".45"/></g>')
    s.append(f'<path d="{BODY}" fill="none" stroke="{C["ink"]}" stroke-width="{LW}" stroke-linejoin="round"/>')
    # tuft
    s.append(f'<path d="M {196+dx*0.4} 76 C {190+dx*0.4} 56 {210+dx*0.4} 48 {216+dx*0.4} 62" fill="none" '
             f'stroke="{C["ink"]}" stroke-width="{LW}" stroke-linecap="round"/>')
    # wings
    up = expr == "happy"
    lw = ("M 84 214 C 56 196 40 176 46 164 C 64 170 86 188 92 206 Z" if up
          else "M 86 210 C 62 220 60 262 84 274 C 92 252 92 232 86 210 Z")
    rw = ("M 316 214 C 344 196 360 176 354 164 C 336 170 314 188 308 206 Z" if up
          else "M 314 210 C 338 220 340 262 316 274 C 308 252 308 232 314 210 Z")
    for d in ((lw,) if view == "three" else (lw, rw)):
        s.append(f'<path d="{d}" fill="{C["body"]}" stroke="{C["ink"]}" stroke-width="{LW}" stroke-linejoin="round"/>')
    # feet
    for fx in (166 + dx * 0.3, 234 + dx * 0.3):
        s.append(f'<ellipse cx="{fx}" cy="358" rx="20" ry="8" fill="{C["bill"]}" stroke="{C["ink"]}" stroke-width="{LW-1}"/>')
    # lanyard + badge
    bx = 185 + dx * 0.6
    # face
    ex1, ex2 = 164 + dx, 236 + dx
    if view == "three":
        ex2 = ex1 + 58
    by = 188
    bxc = 200 + dx
    # bill
    if expr in ("happy", "concerned"):
        open_h = 14 if expr == "happy" else 7
        s.append(f'<path d="M {bxc-12} {by+4} Q {bxc} {by+4+open_h*1.6} {bxc+12} {by+4} Z" fill="{C["mouth"]}" '
                 f'stroke="{C["ink"]}" stroke-width="3" stroke-linejoin="round"/>')
    s.append(f'<path d="M {bxc-18} {by} C {bxc-18} {by-12} {bxc+18} {by-12} {bxc+18} {by} '
             f'C {bxc+18} {by+8} {bxc+8} {by+10} {bxc} {by+10} C {bxc-8} {by+10} {bxc-18} {by+8} {bxc-18} {by} Z" '
             f'fill="{C["bill"]}" stroke="{C["ink"]}" stroke-width="3.2" stroke-linejoin="round"/>')
    s.append(f'<circle cx="{bxc-6}" cy="{by-3}" r="1.6" fill="{C["bill_dk"]}"/><circle cx="{bxc+6}" cy="{by-3}" r="1.6" fill="{C["bill_dk"]}"/>')
    # eyes
    s.append(bead(ex1, 168) + bead(ex2, 168))
    # brows
    brow = {
        "focused": [(ex1 - 10, 150, ex1 + 9, 155), (ex2 - 9, 155, ex2 + 10, 150)],
        "concerned": [(ex1 - 10, 154, ex1 + 9, 148), (ex2 - 9, 148, ex2 + 10, 154)],
        "happy": [],
        "neutral": [],
    }[expr]
    for x1, y1, x2, y2 in brow:
        s.append(f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{C["ink"]}" stroke-width="3.6" stroke-linecap="round"/>')
    if expr == "happy":
        for (x, y, r) in [(92, 118, 0), (312, 118, 0)]:
            s.append(f'<path d="M {x} {y-9} L {x} {y+9} M {x-9} {y} L {x+9} {y}" stroke="{C["bill"]}" stroke-width="3.5" stroke-linecap="round"/>')
    if expr == "concerned":
        s.append(f'<path d="M 268 128 C 262 140 260 146 268 150 C 276 146 274 140 268 128 Z" fill="{C["drop"]}" '
                 f'stroke="{C["ink"]}" stroke-width="2.5" stroke-linejoin="round"/>')
    return "".join(s)


def svg_doc(inner, w=400, h=400, bg=None):
    b = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{b}{inner}</svg>'


def text(x, y, t, size=16, weight=400, fill=None, anchor="start", family="Inter"):
    return (f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill or C["ink"]}" text-anchor="{anchor}">{t}</text>')


EXPR = [("neutral", "Neutral", "Default, idle, navigation"),
        ("happy", "Happy", "Clean result, task complete"),
        ("focused", "Focused", "Scanning, reviewing, loading"),
        ("concerned", "Concerned", "Red flag found (serious tone)")]


def sheet():
    W, H = 1600, 1040
    g = [f'<rect width="{W}" height="{H}" fill="{C["bg"]}"/>']
    g.append(text(64, 92, "Dilly", 56, 800))
    g.append(text(64, 128, "DueDilly compliance agent  ·  Character sheet v3, soft style", 20, 500, C["muted"]))

    def panel(x, y, w, h):
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="22" fill="#FFFDF7" stroke="#EADFC4" stroke-width="2"/>'
    g.append(panel(64, 160, 440, 470) + panel(528, 160, 440, 470) + panel(992, 160, 544, 470))
    g.append(f'<g transform="translate(84 186)">{dilly("a", "neutral", "front")}</g>')
    g.append(f'<g transform="translate(548 186)">{dilly("b", "neutral", "three")}</g>')
    g.append(text(284, 606, "Front (primary)", 20, 700, anchor="middle"))
    g.append(text(748, 606, "Three-quarter", 20, 700, anchor="middle"))
    g.append(text(1022, 206, "Palette", 22, 700))
    sw = [("body", "Cream yellow"), ("belly", "Belly cream"), ("bill", "Bill and feet"),
          ("teal", "Pond teal (accent)"), ("ink", "Ink outline")]
    for i, (k, label) in enumerate(sw):
        yy = 236 + i * 46
        g.append(f'<rect x="1022" y="{yy}" width="36" height="36" rx="9" fill="{C[k]}" stroke="{C["ink"]}" stroke-width="2"/>')
        g.append(text(1072, yy + 16, label, 16, 600))
        g.append(text(1072, yy + 34, C[k], 14, 400, C["muted"], family="DejaVu Sans Mono"))
    g.append(text(1262, 206, "Rules", 22, 700))
    rules = ["One soft blob: head and body", "Thin outline, flat fill", "Bead eyes, wide-set, always",
             "Pale belly patch", "Bill and feet: one orange", "Brows and bill carry emotion"]
    for i, r in enumerate(rules):
        g.append(f'<circle cx="1268" cy="{231 + i*40}" r="4" fill="{C["teal"]}"/>')
        g.append(text(1282, 237 + i * 40, r, 15, 500))
    g.append(text(64, 690, "Expressions", 26, 700))
    for i, (e, name, use) in enumerate(EXPR):
        x = 64 + i * 374
        g.append(panel(x, 712, 354, 296))
        g.append(f'<g transform="translate({x+67} 716) scale(0.55)">{dilly("e"+str(i), e, "front")}</g>')
        g.append(text(x + 177, 964, name, 20, 700, anchor="middle"))
        g.append(text(x + 177, 988, use, 15, 500, C["muted"], anchor="middle"))
    return svg_doc("".join(g), W, H)


if __name__ == "__main__":
    s = sheet()
    open(f"{OUT}/dilly_v3_character_sheet.svg", "w").write(s)
    cairosvg.svg2png(bytestring=s.encode(), write_to=f"{OUT}/dilly_v3_character_sheet.png", output_width=2400)
    cairosvg.svg2png(bytestring=s.encode(), write_to="/tmp/dilly3_preview.png", output_width=1400)
    for e, *_ in EXPR:
        d = svg_doc(dilly("x", e, "front"))
        open(f"{OUT}/dilly_v3_{e}.svg", "w").write(d)
        cairosvg.svg2png(bytestring=d.encode(), write_to=f"{OUT}/dilly_v3_{e}.png", output_width=800)
    d = svg_doc(dilly("x", "neutral", "three"))
    open(f"{OUT}/dilly_v3_three_quarter.svg", "w").write(d)
    cairosvg.svg2png(bytestring=d.encode(), write_to=f"{OUT}/dilly_v3_three_quarter.png", output_width=800)
    print("done")

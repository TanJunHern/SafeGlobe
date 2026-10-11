"""Builds the Dilly loader preview page and a standalone animated SVG from one source."""
import os

SCR = "/tmp/gemini-0/-home-gemini/4467025d-057e-5da9-bb3b-c45f0b9ca5aa/scratchpad"
OUT = "/tmp/dilly_loader"
os.makedirs(OUT, exist_ok=True)

BODY = ("M 200 74 C 284 74 318 150 326 232 C 333 300 320 352 268 358 "
        "L 132 358 C 80 352 67 300 74 232 C 82 150 116 74 200 74 Z")

# Dilly v3 front view, split into named parts so each one can move on its own.
DUCK = f"""<g class="ripples"><ellipse class="rp" cx="200" cy="364" rx="150" ry="20"/><ellipse class="rp rp2" cx="200" cy="364" rx="150" ry="20"/></g>
<ellipse class="pond-shadow" cx="200" cy="366" rx="112" ry="10"/>
<g class="duck">
<path class="tail" d="M 316 312 C 346 312 360 290 356 268 C 346 284 334 292 312 294 Z"/>
<g class="body"><defs><clipPath id="__ID__c"><path d="{BODY}"/></clipPath></defs>
<path class="fill-body" d="{BODY}"/>
<g clip-path="url(#__ID__c)"><ellipse class="fill-belly" cx="200" cy="282" rx="96" ry="84"/><path class="fill-shade" d="M 300 120 C 330 180 336 280 318 352 L 360 360 L 360 100 Z"/></g>
<path class="outline" d="{BODY}"/></g>
<g class="wing wing-l"><path class="w-down" d="M 86 210 C 62 220 60 262 84 274 C 92 252 92 232 86 210 Z"/><path class="w-up" d="M 84 214 C 56 196 40 176 46 164 C 64 170 86 188 92 206 Z"/></g>
<g class="wing wing-r"><path class="w-down" d="M 314 210 C 338 220 340 262 316 274 C 308 252 308 232 314 210 Z"/><path class="w-up" d="M 316 214 C 344 196 360 176 354 164 C 336 170 314 188 308 206 Z"/></g>
<ellipse class="foot foot-l" cx="166" cy="358" rx="20" ry="8"/><ellipse class="foot foot-r" cx="234" cy="358" rx="20" ry="8"/>
<path class="tuft" d="M 196 76 C 190 56 210 48 216 62"/>
<g class="brows brows-focus"><path d="M 154 150 L 173 155"/><path d="M 227 155 L 246 150"/></g>
<g class="brows brows-flag"><path d="M 154 154 L 173 148"/><path d="M 227 148 L 246 154"/></g>
<g class="brows brows-angry"><path d="M 149 145 L 177 158"/><path d="M 223 158 L 251 145"/></g>
<path class="mouth mouth-happy" d="M 188 192 Q 200 214.4 212 192 Z"/>
<path class="mouth mouth-flag" d="M 188 192 Q 200 203.2 212 192 Z"/>
<path class="bill" d="M 182 188 C 182 176 218 176 218 188 C 218 196 208 198 200 198 C 192 198 182 196 182 188 Z"/>
<circle class="nostril" cx="194" cy="185" r="1.6"/><circle class="nostril" cx="206" cy="185" r="1.6"/>
<g class="eyes"><g class="eye"><circle class="bead" cx="164" cy="168" r="6.8"/><circle class="glint" cx="161.8" cy="165.6" r="2"/><path class="lid" d="M 154 156 L 175 156 L 175 166 L 154 161 Z"/><path class="lid-line" d="M 154 161 L 175 166"/></g><g class="eye"><circle class="bead" cx="236" cy="168" r="6.8"/><circle class="glint" cx="233.8" cy="165.6" r="2"/><path class="lid" d="M 225 156 L 246 156 L 246 161 L 225 166 Z"/><path class="lid-line" d="M 225 166 L 246 161"/></g></g>
<g class="sparkles"><path d="M 92 109 L 92 127 M 83 118 L 101 118"/><path d="M 312 109 L 312 127 M 303 118 L 321 118"/></g>
<path class="drop" d="M 268 128 C 262 140 260 146 268 150 C 276 146 274 140 268 128 Z"/>
<g class="alert"><circle class="alert-bg" cx="300" cy="100" r="16"/><path class="alert-mark" d="M 300 91 L 300 102"/><circle class="alert-dot" cx="300" cy="109" r="2.3"/></g>
<g class="steam"><g transform="translate(136 90) scale(1.7)"><path class="puff" d="M -10 4 C -16 4 -16 -4 -10 -5 C -10 -12 -1 -13 1 -8 C 4 -13 13 -11 12 -4 C 18 -3 17 5 11 5 Z"/></g><g transform="translate(264 90) scale(1.7)"><path class="puff p2" d="M -10 4 C -16 4 -16 -4 -10 -5 C -10 -12 -1 -13 1 -8 C 4 -13 13 -11 12 -4 C 18 -3 17 5 11 5 Z"/></g></g>
</g>"""

DUCK_CSS = """
.dl{--ink:#3A3541;--body:#F6DD8E;--belly:#FFF6DC;--shade:#E9C873;--bill:#EE8B3A;--billdk:#C9662A;--mouth:#8A3A1C;--drop:#9CCBE0;--rip:var(--teal,#1F6F6B);overflow:visible}
.dl .tail,.dl .wing path{fill:var(--body);stroke:var(--ink);stroke-width:4;stroke-linejoin:round}
.dl .fill-body{fill:var(--body)}.dl .fill-belly{fill:var(--belly)}.dl .fill-shade{fill:var(--shade);opacity:.45}
.dl .outline{fill:none;stroke:var(--ink);stroke-width:4;stroke-linejoin:round}
.dl .foot{fill:var(--bill);stroke:var(--ink);stroke-width:3}
.dl .tuft{fill:none;stroke:var(--ink);stroke-width:4;stroke-linecap:round}
.dl .brows path{stroke:var(--ink);stroke-width:3.6;stroke-linecap:round;fill:none}
.dl .mouth{fill:var(--mouth);stroke:var(--ink);stroke-width:3;stroke-linejoin:round}
.dl .bill{fill:var(--bill);stroke:var(--ink);stroke-width:3.2;stroke-linejoin:round}
.dl .nostril{fill:var(--billdk)}.dl .bead{fill:var(--ink)}.dl .glint{fill:#fff}
.dl .sparkles path{stroke:var(--bill);stroke-width:3.5;stroke-linecap:round;fill:none}
.dl .drop{fill:var(--drop);stroke:var(--ink);stroke-width:2.5;stroke-linejoin:round}
.dl .rp{fill:none;stroke:var(--rip);stroke-width:2.5;opacity:0}
.dl .pond-shadow{fill:var(--rip);opacity:.12}
.dl .lid{fill:var(--body)}.dl .lid-line{stroke:var(--ink);stroke-width:3;stroke-linecap:round;fill:none}
.dl .brows-angry path{stroke-width:4.6}
.dl .alert-bg{fill:#E0A23A;stroke:var(--ink);stroke-width:3}.dl .alert-mark{stroke:#fff;stroke-width:4;stroke-linecap:round;fill:none}.dl .alert-dot{fill:#fff}
.dl .puff{fill:#fff;stroke:var(--ink);stroke-width:1.6;stroke-linejoin:round}
.dl .w-up,.dl .mouth,.dl .brows,.dl .sparkles,.dl .drop,.dl .lid,.dl .lid-line,.dl .alert,.dl .steam{display:none}

/* pivot points: every moving part turns around its own joint */
.dl .duck,.dl .wing,.dl .tail,.dl .foot,.dl .eye,.dl .eyes,.dl .rp,.dl .sparkles path,.dl .alert,.dl .puff{transform-box:fill-box}
.dl .duck{transform-origin:50% 100%}.dl .wing-l{transform-origin:85% 8%}.dl .wing-r{transform-origin:15% 8%}
.dl .tail{transform-origin:0% 60%}.dl .foot,.dl .eye,.dl .rp,.dl .sparkles path,.dl .alert,.dl .puff{transform-origin:50% 50%}

/* working: screening or reading */
.dl:is([data-state="screening"],[data-state="reading"]) .brows-focus{display:inline}
.dl:is([data-state="screening"],[data-state="reading"]) .duck{animation:dl-bob 1.6s ease-in-out infinite}
.dl:is([data-state="screening"],[data-state="reading"]) .rp{animation:dl-rip 1.6s ease-out infinite}
.dl:is([data-state="screening"],[data-state="reading"]) .rp2{animation-delay:.8s}
.dl:is([data-state="screening"],[data-state="reading"]) .wing-l{animation:dl-flap-l .8s ease-in-out infinite alternate}
.dl:is([data-state="screening"],[data-state="reading"]) .wing-r{animation:dl-flap-r .8s ease-in-out infinite alternate}
.dl:is([data-state="screening"],[data-state="reading"]) .tail{animation:dl-wag 1.2s ease-in-out infinite alternate}
.dl:is([data-state="screening"],[data-state="reading"]) .foot{animation:dl-paddle .8s ease-in-out infinite alternate}
.dl:is([data-state="screening"],[data-state="reading"]) .foot-r{animation-delay:-.4s}
.dl[data-state="screening"] .eyes{animation:dl-scan 2.4s ease-in-out infinite}
.dl[data-state="reading"] .eyes{animation:dl-read 2.8s linear infinite}
.dl .eye{animation:dl-blink 4s infinite}

/* done: one hop, sparkles, then a slow bob */
.dl[data-state="done"] .w-down{display:none}
.dl[data-state="done"] :is(.w-up,.mouth-happy,.sparkles){display:inline}
.dl[data-state="done"] .duck{animation:dl-hop .7s cubic-bezier(.3,.7,.4,1) both,dl-bob 2.4s ease-in-out .7s infinite}
.dl[data-state="done"] .sparkles path{animation:dl-pop .5s ease-out .2s both}

/* error: the AI service failed. Cream Dilly, sweat drop, still apart from blinking */
.dl[data-state="error"] :is(.brows-flag,.mouth-flag,.drop){display:inline}

/* medium risk (Investigate, amber): orange Dilly, concerned, "!" pulses gently */
.dl[data-state="medium"]{--body:#F6BE72;--belly:#FFEBD0;--shade:#EAA454;--bill:#E1712A;--billdk:#B5561C}
.dl[data-state="medium"] :is(.brows-flag,.mouth-flag,.alert){display:inline}
.dl[data-state="medium"] .alert{animation:dl-nudge 2.4s ease-in-out infinite}

/* sanctions match (Escalate, red): red Dilly, angry, shakes, steam, red ripples */
.dl[data-state="sanctions"]{--body:#EC8273;--belly:#FCDDD6;--shade:#D8604F;--bill:#F3B23F;--billdk:#C98A1E;--rip:#D9604F}
.dl[data-state="sanctions"] :is(.brows-angry,.mouth-flag,.lid,.lid-line,.steam){display:inline}
.dl[data-state="sanctions"] .duck{animation:dl-shake 1.8s ease-in-out infinite}
.dl[data-state="sanctions"] .wing-l{transform:rotate(16deg)}.dl[data-state="sanctions"] .wing-r{transform:rotate(-16deg)}
.dl[data-state="sanctions"] .rp{animation:dl-rip 1.6s ease-out infinite}.dl[data-state="sanctions"] .rp2{animation-delay:.8s}
.dl[data-state="sanctions"] .puff{animation:dl-steam 1.6s ease-out infinite}.dl[data-state="sanctions"] .p2{animation-delay:.8s}

@keyframes dl-bob{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-7px) rotate(1.5deg)}}
@keyframes dl-rip{0%{transform:scale(.55);opacity:.8}100%{transform:scale(1.25);opacity:0}}
@keyframes dl-flap-l{from{transform:rotate(0)}to{transform:rotate(12deg)}}
@keyframes dl-flap-r{from{transform:rotate(0)}to{transform:rotate(-12deg)}}
@keyframes dl-wag{from{transform:rotate(-8deg)}to{transform:rotate(8deg)}}
@keyframes dl-paddle{from{transform:translateY(0)}to{transform:translateY(-3px)}}
@keyframes dl-scan{0%,100%{transform:translateX(-5px)}50%{transform:translateX(5px)}}
@keyframes dl-read{0%{transform:translate(-7px,-2px)}40%{transform:translate(7px,-2px)}45%{transform:translate(-7px,2px)}85%{transform:translate(7px,2px)}90%,100%{transform:translate(-7px,-2px)}}
@keyframes dl-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}
@keyframes dl-hop{0%{transform:translateY(0)}35%{transform:translateY(-20px)}65%{transform:translateY(3px)}100%{transform:translateY(0)}}
@keyframes dl-pop{0%{transform:scale(0) rotate(-45deg);opacity:0}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes dl-nudge{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@keyframes dl-shake{0%,30%,100%{transform:translateX(0)}4%{transform:translateX(-4px) rotate(-1.5deg)}8%{transform:translateX(4px) rotate(1.5deg)}12%{transform:translateX(-4px) rotate(-1.5deg)}16%{transform:translateX(4px) rotate(1.5deg)}20%{transform:translateX(-2px)}24%{transform:translateX(0)}}
@keyframes dl-steam{0%{transform:translateY(4px) scale(.5);opacity:0}30%{opacity:1}100%{transform:translateY(-16px) scale(1.1);opacity:0}}
@media (prefers-reduced-motion:reduce){.dl,.dl *{animation:none!important}}
"""

VIEWBOX = "0 24 400 376"


def standalone(state, name):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VIEWBOX}" width="400" height="376" '
           f'class="dl" data-state="{state}"><style>{DUCK_CSS}</style>{DUCK.replace("__ID__", "dl")}</svg>')
    open(f"{OUT}/{name}", "w").write(svg)


standalone("screening", "dilly_loading.svg")
standalone("reading", "dilly_reading.svg")
standalone("done", "dilly_done.svg")
standalone("medium", "dilly_medium.svg")
standalone("sanctions", "dilly_sanctions.svg")
standalone("error", "dilly_error.svg")

PAGE = r"""<title>Dilly Loader</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: pond stage beside its controls, then a working drawer demo, then how to use it. Pond palette from the DueDilly rebrand spec. */
:root{--bg:#FBF6E9;--surface:#FFFDF7;--surface2:#F4ECDA;--border:#EADFC4;--fg:#2E2A33;--muted:#6B6573;--teal:#1F6F6B;--teal-fg:#FFFDF7;--orange:#EE8B3A;--water:#DCEBE8;--low-bg:#E5EFE3;--low-fg:#3F6B3B;--high-bg:#FBE4DF;--high-fg:#9C3A2C;--mid-bg:#FBEBCF;--mid-fg:#8A5A0E;
--display:'Fredoka','Baloo 2',ui-rounded,system-ui,sans-serif;--sans:'Figtree',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'JetBrains Mono',ui-monospace,'SFMono-Regular',Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121A1B;--surface:#1B2426;--surface2:#222E30;--border:#2A3638;--fg:#F2EEE6;--muted:#A9B3B2;--teal:#3FA39C;--teal-fg:#0E1516;--water:#16292A;--low-bg:#1F3022;--low-fg:#A3CF9D;--high-bg:#3A2422;--high-fg:#F2A397;--mid-bg:#3A2E18;--mid-fg:#F2C77A;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121A1B;--surface:#1B2426;--surface2:#222E30;--border:#2A3638;--fg:#F2EEE6;--muted:#A9B3B2;--teal:#3FA39C;--teal-fg:#0E1516;--water:#16292A;--low-bg:#1F3022;--low-fg:#A3CF9D;--high-bg:#3A2422;--high-fg:#F2A397;--mid-bg:#3A2E18;--mid-fg:#F2C77A;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:16px/1.55 var(--sans)}
.wrap{max-width:1080px;margin:0 auto;padding-inline:20px;padding-block:40px 64px;display:grid;gap:44px}
h1,h2,h3{font-family:var(--display);font-weight:600;margin:0;text-wrap:balance}
h1{font-size:clamp(2.3rem,6vw,3.4rem);line-height:1.02}
h2{font-size:1.3rem}
.eyebrow{font:500 .75rem/1 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--teal);margin:0 0 .7rem}
.lead{max-width:62ch;color:var(--muted);margin:.7rem 0 0}
.note{color:var(--muted);font-size:.93rem;margin:0}
.stage{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:24px}
.pond{background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:36px 24px 28px;display:grid;justify-items:center;align-content:center;gap:10px;min-height:440px}
#big{width:100%;display:grid;justify-items:center}.pond .dl{width:min(280px,78%);height:auto}
.status{font-family:var(--display);font-weight:500;font-size:1.4rem;margin:6px 0 0;text-align:center}
.controls{display:grid;gap:22px;align-content:start;min-width:0}
.group{display:grid;gap:10px}
.seg{display:flex;flex-wrap:wrap;gap:8px}
.seg button,.ghost{font:600 .9rem var(--sans);padding:.5rem .95rem;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--fg);cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--teal);color:var(--teal-fg);border-color:var(--teal)}
button:focus-visible,input:focus-visible{outline:3px solid var(--orange);outline-offset:2px}
.check{display:flex;align-items:center;gap:.55rem;font-weight:500;cursor:pointer;width:fit-content}
.check input{width:18px;height:18px;accent-color:var(--teal)}
.tbl{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.92rem}
th,td{text-align:left;padding:.5rem .45rem;border-bottom:1px solid var(--border);vertical-align:top}
th{font:500 .7rem var(--mono);text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
td.t{font:400 .8rem var(--mono);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.inapp{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:24px;align-items:start}
.drawer{background:var(--surface);border:1px solid var(--border);border-radius:18px;overflow:hidden;min-width:0}
.d-head{padding:18px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.d-head h3{font-size:1.2rem}
.meta{color:var(--muted);font-size:.86rem;margin:.15rem 0 0}
.tag{font:500 .68rem var(--mono);text-transform:uppercase;letter-spacing:.07em;background:var(--surface2);color:var(--muted);padding:.3rem .55rem;border-radius:6px;white-space:nowrap}
.d-body{padding:20px;display:grid;gap:16px}
.row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
.primary{background:var(--teal);color:var(--teal-fg);border:0;border-radius:999px;padding:.65rem 1.25rem;font:600 .95rem var(--sans);cursor:pointer}
.primary:disabled{opacity:.55;cursor:default}
.elapsed{font:400 .85rem var(--mono);color:var(--muted);font-variant-numeric:tabular-nums}
.area{min-height:140px;border:1px dashed var(--border);border-radius:14px;display:grid;align-items:center;padding:16px 18px}
.idle{color:var(--muted);margin:0;text-align:center}
.loader,.result{display:flex;gap:16px;align-items:center;min-width:0}
.loader .dl{width:76px;height:auto;flex:none}.result .dl{width:58px;height:auto;flex:none}
.l-title{font-family:var(--display);font-weight:500;font-size:1.12rem;margin:0}
.slow{margin:.2rem 0 0;color:var(--muted);font-size:.92rem}
.result p{margin:.12rem 0}.r-title{font-weight:700}
.r-meta{font:400 .8rem var(--mono);color:var(--muted)}
.pill{display:inline-block;padding:.05rem .55rem;border-radius:999px;font-size:.8rem;font-weight:600}
.pill.low{background:var(--low-bg);color:var(--low-fg)}.pill.mid{background:var(--mid-bg);color:var(--mid-fg)}.pill.high{background:var(--high-bg);color:var(--high-fg)}
.result.mid .r-title{color:var(--mid-fg)}.result.high .r-title{color:var(--high-fg)}
.rules{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:20px;display:grid;gap:12px;min-width:0}
.rules ul{margin:0;padding-left:1.1rem;display:grid;gap:.5rem}
.rules b{font-family:var(--mono);font-weight:500;font-size:.88rem}
.use{display:grid;gap:14px}
.use .cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
pre{background:var(--surface2);border-radius:12px;padding:14px 16px;overflow-x:auto;font:400 .82rem/1.55 var(--mono);margin:0}
.dots i{font-style:normal;opacity:.2;animation:dot 1.2s infinite}.dots i::before{content:"."}
.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}
@keyframes dot{0%,60%,100%{opacity:.2}30%{opacity:1}}
.rm .dl,.rm .dl *,.rm .dots i{animation:none!important}.rm .dots i{opacity:1}
@media (prefers-reduced-motion:reduce){.dots i{animation:none;opacity:1}}
@media (max-width:820px){.stage,.inapp,.use .cols{grid-template-columns:1fr}.pond{min-height:360px}}
__DUCK_CSS__
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">DueDilly · AI loading states</p>
    <h1>Dilly Loader</h1>
    <p class="lead">Dilly is split into parts (body, wings, feet, tail, eyes, ripples), and each part moves around its own joint with CSS. Pick a state, or run a simulated check in the drawer below.</p>
  </header>

  <section class="stage" aria-label="Preview">
    <div class="pond">
      <div id="big"></div>
      <p class="status" id="status" role="status" aria-live="polite"></p>
    </div>
    <div class="controls">
      <div class="group">
        <h2>State</h2>
        <div class="seg" id="states">
          <button type="button" data-s="screening" aria-pressed="true">Screening</button>
          <button type="button" data-s="reading" aria-pressed="false">Reading a document</button>
          <button type="button" data-s="done" aria-pressed="false">Clear</button>
          <button type="button" data-s="medium" aria-pressed="false">Medium risk</button>
          <button type="button" data-s="sanctions" aria-pressed="false">Sanctions match</button>
          <button type="button" data-s="error" aria-pressed="false">Error</button>
        </div>
        <p class="note" id="stateNote"></p>
        <label class="check" for="rm"><input type="checkbox" id="rm"> Preview with reduced motion</label>
      </div>
      <div class="group">
        <h2>What moves</h2>
        <div class="tbl"><table>
          <thead><tr><th>Part</th><th>Motion</th><th>Timing</th></tr></thead>
          <tbody>
            <tr><td>Body</td><td>Bobs on the water, tilting slightly</td><td class="t">1.6s loop</td></tr>
            <tr><td>Wings</td><td>Flap from the shoulder</td><td class="t">0.8s</td></tr>
            <tr><td>Feet</td><td>Paddle, one after the other</td><td class="t">0.8s</td></tr>
            <tr><td>Tail</td><td>Wags from where it joins the body</td><td class="t">1.2s</td></tr>
            <tr><td>Eyes</td><td>Scan side to side; line by line when reading</td><td class="t">2.4s / 2.8s</td></tr>
            <tr><td>Eyes</td><td>Blink in every state</td><td class="t">every 4s</td></tr>
            <tr><td>Ripples</td><td>Two rings spread out and fade</td><td class="t">1.6s, 0.8s apart</td></tr>
            <tr><td>Medium risk</td><td>Orange Dilly; the "!" pulses gently</td><td class="t">2.4s</td></tr>
            <tr><td>Sanctions</td><td>Red Dilly shakes; steam rises; red ripples</td><td class="t">1.8s / 1.6s</td></tr>
          </tbody>
        </table></div>
      </div>
    </div>
  </section>

  <section class="inapp" aria-label="Simulated check">
    <div class="drawer">
      <div class="d-head">
        <div>
          <h3>Meridian Port Logistics Pte. Ltd.</h3>
          <p class="meta">Logistics · Singapore · Service provider</p>
        </div>
        <span class="tag">Sample data</span>
      </div>
      <div class="d-body">
        <div class="group">
          <p class="note">How the AI service responds</p>
          <div class="seg" id="modes">
            <button type="button" data-m="fast" aria-pressed="false">Fast, 0.2s</button>
            <button type="button" data-m="normal" aria-pressed="true">Normal, 3.2s</button>
            <button type="button" data-m="slow" aria-pressed="false">Slow, 10s</button>
            <button type="button" data-m="medium" aria-pressed="false">Medium risk</button>
            <button type="button" data-m="sanctions" aria-pressed="false">Sanctions match</button>
            <button type="button" data-m="error" aria-pressed="false">Error</button>
          </div>
        </div>
        <div class="row">
          <button type="button" class="primary" id="run">Run AI check</button>
          <span class="elapsed" id="elapsed">0.0s</span>
        </div>
        <div class="area" id="area" aria-live="polite"><p class="idle">Run the check to see the loader.</p></div>
      </div>
    </div>
    <aside class="rules">
      <h2>Timing rules</h2>
      <ul>
        <li>Appears only after <b>300ms</b>, so fast answers never flash a loader. Try "Fast".</li>
        <li>Once shown, stays at least <b>600ms</b>.</li>
        <li>After <b>8s</b>, adds "This is taking longer than usual." Try "Slow".</li>
        <li>The result pose follows the route: cream and happy for Auto-clear, orange for Investigate, red for a sanctions Escalate.</li>
        <li>On error, cream Dilly with a sweat drop and Try again. An error is not a risk finding, so it never turns orange or red.</li>
        <li>With reduced motion turned on, Dilly stays still and the text still updates.</li>
      </ul>
    </aside>
  </section>

  <section class="use" aria-label="Use it in the app">
    <h2>Use it in the app</h2>
    <div class="cols">
      <div class="group">
        <p class="note">The SVG files carry their own animation, so a plain image tag works anywhere.</p>
        <pre>&lt;img src="/mascot/dilly_loading.svg" width="72" alt=""&gt;</pre>
      </div>
      <div class="group">
        <p class="note">To switch states without swapping files, paste the SVG inline and change one attribute.</p>
        <pre>// screening | reading | done | medium | sanctions | error
svg.dataset.state = "done";</pre>
      </div>
    </div>
  </section>
</div>

<script>
const DUCK = `__DUCK__`;
let uid = 0;
function duck(state){ uid++; return `<svg class="dl" data-state="${state}" viewBox="__VB__" aria-hidden="true" focusable="false">${DUCK.split('__ID__').join('d'+uid)}</svg>`; }
const DOTS = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';

const STATES = {
  screening: ['Dilly is screening', true, 'Used while a screen or the AI KYCP check runs.'],
  reading:   ['Dilly is reading the document', true, 'Used during document auto-fill. The eyes move line by line.'],
  done:      ['Screening complete', false, 'Low risk, Auto-clear route. One hop and sparkles, then a slow bob.'],
  medium:    ['Medium risk: needs a closer look', false, 'Investigate route (amber). Dilly turns orange, looks concerned, and the "!" pulses gently.'],
  sanctions: ['Sanctions match', false, 'Escalate route on a sanctions hit. Dilly turns red and frowns, shakes every 2 seconds, and steam and red ripples rise.'],
  error:     ["The check didn't finish", false, 'The AI service failed. Dilly stays cream with a sweat drop, so an error never looks like a risk finding.']
};
const big = document.getElementById('big');
big.innerHTML = duck('screening');
const bigSvg = big.querySelector('svg');
function setState(s){
  bigSvg.setAttribute('data-state', s);
  const [text, working, note] = STATES[s];
  document.getElementById('status').innerHTML = text + (working ? DOTS : '');
  document.getElementById('stateNote').textContent = note;
  document.querySelectorAll('#states button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === s)));
}
document.getElementById('states').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setState(b.dataset.s); });
setState('screening');

document.getElementById('rm').addEventListener('change', e => document.documentElement.classList.toggle('rm', e.target.checked));

let mode = 'normal';
document.getElementById('modes').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  mode = b.dataset.m;
  document.querySelectorAll('#modes button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});

const area = document.getElementById('area'), runBtn = document.getElementById('run'), elapsed = document.getElementById('elapsed');
const DURATION = { fast: 200, normal: 3200, slow: 10000, medium: 3200, sanctions: 3200, error: 2600 };
let busy = false;
function runCheck(){
  if (busy) return;
  busy = true; runBtn.disabled = true;
  area.setAttribute('aria-busy', 'true');
  area.innerHTML = '';
  const t0 = performance.now(); let shownAt = null;
  const tick = setInterval(() => { elapsed.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's'; }, 100);
  const showT = setTimeout(() => {
    shownAt = performance.now();
    area.innerHTML = `<div class="loader" role="status">${duck('screening')}<div><p class="l-title">Dilly is screening${DOTS}</p><p class="slow" hidden>This is taking longer than usual.</p></div></div>`;
  }, 300);
  const slowT = setTimeout(() => { const s = area.querySelector('.slow'); if (s) s.hidden = false; }, 8000);
  const m = mode, d = DURATION[m];
  setTimeout(() => {
    const finish = () => {
      clearTimeout(showT); clearTimeout(slowT); clearInterval(tick);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      elapsed.textContent = secs + 's';
      if (m === 'error') {
        area.innerHTML = `<div class="result">${duck('error')}<div><p class="r-title">The check didn't finish</p><p>The AI service didn't respond in time. Nothing about this counterparty has changed.</p><p><button type="button" class="ghost" id="retry">Try again</button></p></div></div>`;
        document.getElementById('retry').addEventListener('click', runCheck);
      } else if (m === 'medium') {
        area.innerHTML = `<div class="result mid">${duck('medium')}<div><p class="r-title">Medium risk: needs a closer look</p><p>Possible adverse media match, 62% name match. Route: <span class="pill mid">Investigate</span></p><p class="r-meta">Finished in ${secs}s · sample result</p></div></div>`;
      } else if (m === 'sanctions') {
        area.innerHTML = `<div class="result high">${duck('sanctions')}<div><p class="r-title">Sanctions match</p><p>OFAC SDN list, 94% name match. A senior reviewer decides. Route: <span class="pill high">Escalate</span></p><p class="r-meta">Finished in ${secs}s · sample result</p></div></div>`;
      } else {
        area.innerHTML = `<div class="result">${duck('done')}<div><p class="r-title">Screening complete</p><p>No matches on sanctions, PEP or adverse media. Route: <span class="pill low">Auto-clear</span></p><p class="r-meta">Finished in ${secs}s · sample result${shownAt === null ? ' · loader never shown' : ''}</p></div></div>`;
      }
      area.removeAttribute('aria-busy');
      runBtn.disabled = false; busy = false;
    };
    if (shownAt === null) { finish(); return; }
    const visible = performance.now() - shownAt;
    visible < 600 ? setTimeout(finish, 600 - visible) : finish();
  }, d);
}
runBtn.addEventListener('click', runCheck);
</script>
"""

page = (PAGE.replace("__DUCK_CSS__", DUCK_CSS)
            .replace("__DUCK__", DUCK.replace("\n", ""))
            .replace("__VB__", VIEWBOX))
os.makedirs(f"{SCR}/loader", exist_ok=True)
open(f"{SCR}/loader/dilly_loader.html", "w").write(page)
print(len(page))

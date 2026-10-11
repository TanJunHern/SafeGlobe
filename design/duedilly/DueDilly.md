# DueDilly rebrand spec

Rebrand the app from **Safe Globe** to **DueDilly**. Follow this file phase by phase.

## Rules for the agent (read first)

1. Do ONE phase per run, then stop, give a short summary (files changed, anything skipped and why) and wait for approval.
2. Use search (grep / ripgrep) to find things. Do not open whole files unless you need to edit them.
3. Change **user-facing text, styles and icons only**. Do NOT rename:
   - environment variables (`GEMINI_MODEL`, `DOCUMENT_AI_*`, `STORAGE`, etc.)
   - API routes, database collections/keys, storage paths (`data/uploads/ddq/...`)
   - function, file, class or variable names
   - test fixtures and existing data values

   Exception (approved): demo and default email addresses move from `@safeglobe.com` / `@safeglobe.internal` to `@duedilly.com` / `@duedilly.internal` everywhere, including test fixtures, `.env`, `.env.example` and rows in the local database.
4. Do not refactor, reformat or reorder code you are not changing.
5. Do not invent data. If a feature needs data that does not exist, stop and tell me.
6. Keep all existing behaviour, layout structure and data working.

## Assets

Shipped SVGs live in the served folder `assets/` (`assets/mascot/` and `assets/ducklings/`, public at `/assets/...`). Design-only sources (PNG, generator scripts, sheets, this spec) live in `design/duedilly/`, which is not served:

| File | What it is |
| --- | --- |
| `dilly_v3_neutral.svg` | Dilly, default |
| `dilly_v3_happy.svg` | Dilly, clean result |
| `dilly_v3_focused.svg` | Dilly, screening / loading |
| `dilly_v3_concerned.svg` | Dilly, red flag |
| `dilly_v3_three_quarter.svg` | Dilly, chat avatar |
| `ducklings/duckling_icon.svg` | Vessel list icon (with water) |
| `ducklings/duckling_icon_nowater.svg` | Small duckling, for the meter |
| `ducklings/duckling_marker_escalate.svg` | Map marker, red ring |
| `ducklings/duckling_marker_investigate.svg` | Map marker, amber ring |
| `ducklings/duckling_marker_clear.svg` | Map marker, green ring |
| `ducklings/duckling_marker_ais_dark.svg` | Map marker, AIS gap (dashed grey) |
| `ducklings/duckling_marker_gaps.svg` | Map marker, slate ring, for the "Fill the gaps" route (derived from the clear marker) |

PNG files and `*_generator.py` files are for design only. Do not ship them.

---

## Phase 0: Discovery (no edits)

Report back, briefly:

1. Frontend framework and the folder that serves static files (e.g. `public/`, `src/assets/`, `static/`).
2. Where theme colours and fonts are defined (CSS variables, Tailwind config, theme file).
3. Every file containing these strings (case-insensitive), with a count per file:
   `Safe Globe`, `SafeGlobe`, `Safe-Globe`, `safe_globe`, `safeglobe`, `Ask the Globe`, `Radar`, `Risk weather`, `Ownership arcs`
4. Where the vessel/ship icon is used (component and file).
5. Where map markers for vessels are drawn.
6. Where the app `<title>`, favicon and web manifest are set.
7. The command to run the tests and the build.

Do not edit anything in this phase.

---

## Phase 1: Name and copy

Replace these **user-facing strings only** (UI text, page titles, email subject lines and sender names, manifest `name` / `short_name`, README headings). Leave identifiers, env vars and paths alone (see rules).

| Find | Replace with |
| --- | --- |
| Safe Globe / SafeGlobe (display text) | DueDilly |
| SafeGlobe KYC · Employee Portal | DueDilly · Employee Portal |
| Ask the Globe | Ask Dilly |
| Ask the Globe input placeholder | Ask Dilly about a counterparty, vessel or country |
| Radar (alert ticker label and agent name, everywhere) | Ripples |
| Risk weather (layer toggle) | Pond forecast |
| Ownership arcs (layer toggle) | Duckling trail |
| Browser tab title | DueDilly |

Keep unchanged: nav labels (Globe, Reviews, Compliance, DDQ, Sources, Policies), route labels (Escalate, Investigate, Fill the gaps, Auto-clear), "Ongoing screening" and all risk, policy and compliance wording.

Add the tagline **"Get your ducks in a row."** in one place only: the login page, or the landing page if there is no login page.

After this phase, grep again and list any remaining "Safe Globe"/"SafeGlobe" matches, with the reason each one stays (e.g. env var, storage path).

---

## Phase 2: Theme

Define these as theme tokens (CSS variables or the theme config found in Phase 0). Make **Pond (light)** the default. Keep **Night pond (dark)** as the existing theme toggle.

### Pond (light, default)

| Token | Value |
| --- | --- |
| background | `#FBF6E9` |
| surface (cards, panels) | `#FFFDF7` |
| surface-2 (inputs, hovers) | `#F4ECDA` |
| border | `#EADFC4` |
| text | `#2E2A33` |
| text-muted | `#6B6573` |
| brand-teal (primary buttons, links, active nav) | `#1F6F6B` |
| brand-yellow (mascot, highlights) | `#F6DD8E` |
| brand-orange (accents, focus ring) | `#EE8B3A` |
| map land | `#EFE6D2` |
| map water | `#DCEBE8` |

### Night pond (dark)

| Token | Value |
| --- | --- |
| background | `#121A1B` |
| surface | `#1B2426` |
| surface-2 | `#222E30` |
| border | `#2A3638` |
| text | `#F2EEE6` |
| text-muted | `#A9B3B2` |
| brand-teal | `#3FA39C` |
| map land | `#26302F` |
| map water | `#152022` |

### Risk colours (both themes, do not change their meaning)

| Token | Value |
| --- | --- |
| risk-high / Escalate | `#D9604F` |
| risk-elevated / Investigate | `#E0A23A` |
| risk-low / Auto-clear | `#6E9F6A` |

The CPI country fill keeps its existing thresholds (0–39 high, 40–59 elevated, 60–100 low) and uses the risk tokens above.

### Type and shape

- Headings (page titles, panel titles, entity name in the drawer): **Fredoka**, weight 600. Load from Google Fonts.
- Body, tables, numbers: keep the current sans font. Keep the current monospace for coordinates, IDs and codes.
- Card radius 14px. Buttons fully rounded (pill).
- Primary button: brand-teal background, `#FFFDF7` text. Replace the current olive-green primary buttons ("Escalate to reviewer", "Open case", "Add source", etc.).
- Secondary button: surface background, border, text colour.

Replace every hard-coded colour that duplicates a token with the token. List any hard-coded colours you left and why.

---

## Phase 3: Ducklings replace vessel icons

The duckling SVGs are served from `assets/ducklings/` (referred to as `icons/` below).

1. Use `icons/duckling_icon.svg` at 20–24px wherever the vessel/ship icon appears now:
   - watchlist rows for vessels
   - the "Vessels" filter tab in the watchlist
   - the entity drawer header for vessels
   - the "Vessels" toggle in the top bar
   - the case queue counterparty icon for vessels
   Organisation and person icons stay as they are.
2. On the map, draw vessels with `icons/duckling_marker_<route>.svg` at 36px:
   - `<route>` = `escalate`, `investigate`, `gaps` or `clear` (Auto-clear), from the vessel's case route
   - use `duckling_marker_ais_dark.svg` when the vessel has an active AIS gap
   - if the course is between 180° and 360°, mirror the marker image with `transform: scaleX(-1)`. Never rotate it.
3. Keep the existing voyage track lines, AIS gap labels and STS labels.

---

## Phase 4: Dilly in the app

The `dilly_v3_*.svg` files are served from `assets/mascot/` (referred to as `mascot/` below). Dilly appears **only** in the states below. All other screens stay as they are.

| Where | Pose | Size | Text next to it |
| --- | --- | --- | --- |
| While a screen or document auto-fill is running (replace the spinner or loading bar) | focused | 72px | "Dilly is screening…" / "Dilly is reading the document…" |
| Empty watchlist, empty search results, empty review queue | neutral | 96px | keep the existing empty-state text |
| Route banner when the route is Auto-clear (clean result) | happy | 56px | keep the existing banner text |
| Route banner when the route is Escalate | concerned | 56px | keep the existing plain banner text. No jokes. |
| Ask Dilly panel: assistant avatar on each reply | three_quarter | 28px | — |
| DDQ portal (supplier side): top of the form | neutral | 72px | "Hi, I'm Dilly. I'll help you get your ducks in a row." |
| DDQ portal: after successful submission | happy | 96px | "Thanks! Your questionnaire has been submitted." |

Never place Dilly in: risk level or confidence cards, the "What drives the confidence" list, evidence, screening results, the case queue table, decision buttons, or the Policies page.

Every Dilly image needs `alt=""` (decorative) when the text next to it already says what is happening. Otherwise use `alt="Dilly"`.

---

## Phase 5: Ducks-in-a-row meter and ripples

### Ducks-in-a-row meter

Add one card to the top stats strip on the Globe page, after "Open reviews":

- Label: **Ducks in a row, today**
- Value: `<closed today> of <total due today>`. A case counts as closed only if it has a reviewer decision **and** a written reason.
- Under the value, a row of up to 10 slots. Filled slot = `icons/duckling_icon_nowater.svg` at 18px. Empty slot = an 18px circle outline in the border colour. If the total is above 10, scale it so 10 slots = 100%.
- When every case due today is closed, show `mascot/dilly_v3_happy.svg` at 28px at the end of the row.
- Do not count speed or time per case anywhere.

If the case data has no "reason" field or no due date, stop and tell me which field is missing. Do not fake it.

### Ripples

When a new alert arrives in the Ripples ticker (formerly Radar), play a ripple on that entity's map marker: two rings expanding from the marker, 1.6s, played once, in the route colour. Turn it off when `prefers-reduced-motion: reduce` is set.

---

## Phase 6: Docs and architecture names

Use these names in the README, architecture docs, pitch notes and log/status labels only. Do not rename files, functions or env vars.

| Code name | What it is in this codebase |
| --- | --- |
| Duck-Scanner | Document auto-fill using Gemini multimodal. Google Document AI is planned (`src/services/documentParserService.js` placeholder). |
| Pond-Guard | AI KYCP check + Policy RAG evaluator |
| Feather-Weight | Shared Gemini client: `gemini-flash-lite-latest` first, falls back to `gemini-flash-latest`, then `gemini-3.1-flash-lite` on 404/429/503 |
| Duckling Trail | Ownership tracing (registry, filings, news) |
| Ripples | Ongoing monitoring alerts |
| Quack-Back | Smart DDQ: questionnaire sent to the counterparty and answers returned |

Do not mention Gemini 1.5 Pro anywhere. Do not describe Document AI as live.

---

## Phase 7: Verify

1. Run the test suite (Gemini disabled, as it is now) and the build. Both must pass.
2. Grep for `Safe Globe` and `SafeGlobe` again and list what remains, with reasons.
3. Check both themes on: Globe with the watchlist open, a vessel drawer, Reviews, Sources, the DDQ portal. Report anything with contrast problems (text on surface below 4.5:1).
4. Summarise all changes in one list I can paste into the README changelog.
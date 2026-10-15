# Implementation plan: Dilly motion (requested 15 Oct 2026)

Status: approved by the user on 15 Oct 2026 ("do it all for an hour", in phases, `npm test` after every two phases,
revert anything that takes too long to fix). Frontend only. No cloud resource, no API route, no data field changes.

## Goal

Cartoonish, intentional motion in Dilly's style. Each animation marks one moment and says one thing. No new
dependency, no build step, and the first load gets lighter, not heavier.

## Rules every animation follows

- Plays only because the user did something (or a real result arrived). Never on its own, never on a re-render.
- At most 900 ms, and it never holds up the request or the UI. The real result (toast, new state) is shown as today.
- Only `transform` and `opacity` are animated.
- Skipped when the user has reduced motion turned on. The final state is always rendered first in the HTML, so the
  page reads correctly with no JavaScript motion at all.
- Nothing loops forever, except an agent that is really running (a loader).
- Motion tokens follow Material 3: emphasized `cubic-bezier(.2,0,0,1)`, emphasized decelerate
  `cubic-bezier(.05,.7,.1,1)`, emphasized accelerate `cubic-bezier(.3,0,.8,.15)`; 150, 300 and 500 ms.

## Approach

One new file, `dilly-motion.js` (about 6 KB), in the same UMD shape as `dilly-loader.js`: pure helpers that Node can
test, plus DOM helpers that inject their own CSS once. Pages call it only through `window.DillyMotion &&`, so a
missing file never breaks a page.

## Phases

| Phase | What | Files |
| --- | --- | --- |
| M1 | `dilly-motion.js` foundation and tests; serve it (`PUBLIC_ASSETS`, Dockerfile); M3 motion tokens on the toast and drawer; load Three.js only when the sign-in globe is shown | `dilly-motion.js`, `tests/dilly-motion.test.js`, `package.json` (test list), `src/server.js`, `Dockerfile`, `safe-globe.html` |
| M2 | Paper plane on "Send DDQ to Counterparty" (both portals) and on staff invites: flies away when sent, loops back when only a link was made | `safe-globe.html`, `employee-portal.html` |
| | **`npm test`** | |
| M3 | Rubber stamp on Approve, Reject and Request more info (triage modal, one-click queue, audit modal, drawer "Approve and sign") | `safe-globe.html` |
| M4 | "Why <score>?": rows drop in one by one while the score counts up; route card Dilly pose pops in, one short shake for a sanctions escalation. Once per entity and score | `safe-globe.html` |
| | **`npm test`** | |
| M5 | Pond-Guard: a row of ducklings, one per agent. Faded while waiting, bobbing while reading, hops into line when done | `safe-globe.html` |
| M6 | DDQ portal: a section's duckling hops when it turns done; on submit, mommy duck with the envelope waddles in | `ddq-portal.html` |
| | **`npm test`**, then a browser check of each moment | |

## Risks

- `renderDrawer` rebuilds the drawer on every Pond-Guard event. Animations are keyed with `DillyMotion.once(key)` so
  they play once, not on every rebuild.
- The triage modal closes straight after the action. The stamp is a fixed overlay on `body`, so it outlives the modal.
- Three.js lazy load: if the CDN fails, the existing 2D canvas globe is used, as today when WebGL fails.
- `send-ddq` returns no `delivery` field today; the plane flies away on success. If a later response has
  `delivery.sent === false`, the plane loops back instead.

## Verification

- `npm test` after M2, M4 and M6 (baseline: 259 pass, 0 fail).
- New unit tests for the pure helpers (`once`, `planeOutcome`, `stampFor`, `countSteps`).
- `node --check` on every changed inline script block.
- Browser check of each moment, and of reduced motion.

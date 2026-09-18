# e2e lane: one test per acceptance journey (E2E-J1..J6)

Rules (rulings-1640 §1): act only through real controls with trusted input, assert only on the rendered DOM, see each test RED first, and run against a real host (and real Revit where the journey touches it). `cdp.ts` is the whole helper; `host.ps1` starts this checkout's own no-Revit host.

## Before any Pea step (user note, 2026-09-18)

- **Preconditions:** the Chat Model chip names an OpenAI model and the Access chip reads `Trusted`. `requirePea()` reads both chips and fails as `BLOCKED` if either is wrong. Fix the setting; it is not a product defect.
- **Sending:** a send is refused while a turn runs, by design. `sendChat()` waits for the turn to settle, else cancels through the real `cancel` control, then sends and waits for the turn to settle. Only J5 sends over a parked ask on purpose.
- **Cost:** each Pea turn spends the user's OpenAI credit. Run a journey once, when it is ready. Never loop a Pea turn to debug a selector; debug selectors on a non-Pea route.
- **Failures:** a turn that fails for credit or model reasons reports `BLOCKED: <exact status message>`, not a product failure.

Run: `chrome-agent launch --headless`, then `E2E_WEB=… E2E_LABEL=green node tests/e2e/j<N>.ts` from `source/pe-tools`. Revit journeys also take `E2E_TARGET`, `E2E_ROWS`, `E2E_PARAM` and `E2E_VALUE`.

A missing precondition (no Revit bridge, no seed, wrong chips) ends as `RESULT: BLOCKED — …`, never `FAIL`.

## Revit data per journey

- **J3 `E2E_ROWS`:** two rows whose apply is natively clean for a plain text write. Not Mechanical Damper (F-J3-2: its connector reconciliation fails a plain text write), and `E2E_PARAM` is not a Yes/No parameter. The stale-refusal check reads the proposals band row: the Revit value struck, then `→ {edited}`.
- **J4:** one row whose `E2E_PARAM` is a non-empty text parameter. The band row must say `by you`; no visible grid or band control may say delete/remove.

## Seeding J6 (old-shape Work)

J6 needs one unreadable `/families` Work document for `E2E_TARGET`; every `start fresh` consumes it. journeys' live J6 (2026-09-18) consumed project-a' real row, so it must be seeded again before each J6 run. Without it, J6 stops as `PRECONDITION: no old-shape Work seeded`.

Recipe (exec-proof, host stopped, a copy of the store taken first): in the host's thread-state store (`%LOCALAPPDATA%/Positive Energy/Pe.Tools/state/mastra.db` for the installed host; the dev host's own state dir otherwise), copy the value of `families:aside:<n>:families/target:<address>` (the old document `start fresh` set aside byte-for-byte; the 2026-09-18 one has value sha256 `c07521136e225240…`) to `families:families/target:<address>` under the same `threadId`, replacing the fresh Work. Record both value shas in RUN.md. Never seed the user's only copy: the aside row stays.

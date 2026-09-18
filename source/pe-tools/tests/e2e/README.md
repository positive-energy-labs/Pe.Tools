# e2e lane: one test per acceptance journey (E2E-J1..J6)

Rules (rulings-1640 §1): act only through real controls with trusted input, assert only on the rendered DOM, see each test RED first, and run against a real host (and real Revit where the journey touches it). `cdp.ts` is the whole helper; `host.ps1` starts this checkout's own no-Revit host.

## Before any Pea step (user note, 2026-09-18)

- **Preconditions:** the Chat Model chip names an OpenAI model and the Access chip reads `Trusted`. `requirePea()` reads both chips and fails as `BLOCKED` if either is wrong. Fix the setting; it is not a product defect.
- **Sending:** a send is refused while a turn runs, by design. `sendChat()` waits for the turn to settle, else cancels through the real `cancel` control, then sends and waits for the turn to settle. Only J5 sends over a parked ask on purpose.
- **Cost:** each Pea turn spends the user's OpenAI credit. Run a journey once, when it is ready. Never loop a Pea turn to debug a selector; debug selectors on a non-Pea route.
- **Failures:** a turn that fails for credit or model reasons reports `BLOCKED: <exact status message>`, not a product failure.

Run: `chrome-agent launch --headless`, then `E2E_WEB=… E2E_LABEL=green node tests/e2e/j<N>.ts` from `source/pe-tools`. Revit journeys also take `E2E_TARGET`, `E2E_ROWS`, `E2E_PARAM` and `E2E_VALUE`.

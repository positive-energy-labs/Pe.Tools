# Chat head report

## Landed

- `composer-head.tsx` uses one shared 24px `Rail` for the Chat Situation.
- The sentence selects the active thread through `openThread` and keeps an unlisted new thread visible.
- The existing target picker, target refusal, turn status, approvals, `Cluster`, and `PageLog` stay in their current owners.

## Proof

- PROVEN[deterministic, `8786ca8` checkout]: `vp check --fix` then `vp check` over `composer-head.tsx` and `composer-head.test.tsx` passed.
- PROVEN[deterministic, `8786ca8` checkout]: `vp test src/chat/composer-head.test.tsx` passed one test for selector dispatch, current label, one Rail, status, approval, and log presence.
- UNPROVEN[browser]: no browser session was opened.

## Corrected narrow verdict

- 2026-09-16, FALSIFIED[artifact, `chat-ready-720.json`]: the document target was the top hit target. The earlier overlap claim was stale.
- 2026-09-16, PROVEN[artifact, `chat-minwidth.json`]: Chat's 386px column generated a 550px implicit grid track. Root owns `chat-shell` grid correction. `Rail` owns the sentence scroller so its thread and document pickers remain reachable after that correction.

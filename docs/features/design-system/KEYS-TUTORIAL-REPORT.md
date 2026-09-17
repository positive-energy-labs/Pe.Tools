# Keys and tutorial cutover report

## Scope

Merged `main` at `97cc548` into `unify/routes` as `6949ef0`; the L4 implementation is this commit. L4 promotes the route-help key treatment to `components/lang/Kbd`, uses it in route help, Situation's vertical projection, and pane shortcut cards, and adds title-only action chords. The help chart now observes its own container, so dialog layout changes redraw the chart instead of retaining an initial measurement. Route manifests now provide factual instructions through the existing `docs` slot.

## Proof

- `vp check --fix` followed by `vp check` over the 15 owned source/test files: pass.
- `vp test src/route/help.test.tsx src/route/shell.test.tsx` from `apps/web`: 2 files, 4 tests pass.
- Browser proof was intentionally not run; root owns it after integration.

## Pending root seams

- Chat lane: replace the two private `<kbd>` elements in `apps/web/src/chat/thread-palette.tsx` and add the factual `docs` paragraph in `apps/web/src/chat/manifest.ts` after that lane releases those files. No Chat or workbench file changed here.
- Product question sent to root: below the current diagram's useful width, should Alt+/ retain horizontal overflow or switch to a stacked region list? This cutover preserves the current chart geometry and fixes only its stale measurement.

## Change size

Source: +40/-27 lines (net +13). Tests: +29/-3 lines (net +26). Report: +20 lines.

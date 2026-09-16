# Diagram font request report

## Result

`sanitizeSvg` now removes only the Google Fonts `@import` rules emitted by `beautiful-mermaid@1.1.3` and normalizes its quoted CSS-variable family to `font-family: var(--font-body), system-ui, sans-serif`. The page-owned theme variable and the library's fallback stack therefore remain effective.

## Cause

- `RenderOptions` exposes `font?: string`, but no `loadFont`, `fontImport`, or equivalent opt-out.
- `buildStyleBlock(font, hasMonoFont)` unconditionally emits `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}` before applying that same value as the SVG text font.
- Therefore Pea's `font: "var(--font-body)"` preserves the page-owned theme token for `font-family`, but also produces the invalid external request `css2?family=var(--font-body)`.

Installed-source evidence:

- `source/pe-tools/node_modules/.pnpm/beautiful-mermaid@1.1.3/node_modules/beautiful-mermaid/src/types.ts` (`RenderOptions.font`)
- `source/pe-tools/node_modules/.pnpm/beautiful-mermaid@1.1.3/node_modules/beautiful-mermaid/src/theme.ts` (`buildStyleBlock`, unconditional `fontImports`)

## Adapter boundary

The normalization matches the renderer's literal `@import url('https://fonts.googleapis.com/css2?family=...');` output and its literal `font-family: 'var(--font-body)',` output. It removes both the primary import and the optional JetBrains Mono import, then unquotes only that known theme token while retaining `system-ui, sans-serif`. It is not a general CSS sanitizer.

## Proof and commit

- Generated flowchart and class-diagram regression: no `fonts.googleapis.com`; the effective `font-family: var(--font-body), system-ui, sans-serif` remains, with no quoted variable token.
- Deterministic focused check: `vp test apps/web/src/components/lang/diagram.test.tsx` - **PASS**, 1 file / 9 tests.
- Focused static check: `vp check apps/web/src/components/lang/diagram.tsx apps/web/src/components/lang/diagram.test.tsx` - **PASS**, formatting, lint, and types.
- Fix commit: `4427579` (`fix diagram font imports`).

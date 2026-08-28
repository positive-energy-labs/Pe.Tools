# PE design language — agent cheat sheet

`base.css` holds the 17 roles and the band math that produced them. `design-lang.css` compiles the
Tailwind vocabulary. This file is the index; the rendered specimen is the `/design-system` route.

## Two surfaces

| Surface | How you get it | What you get |
|---|---|---|
| The app (`apps/web`) | `styles.css` imports both files | every utility below |
| A standalone HTML page | one `<link>` to `base.css` | roles, element defaults, `.page-wrap` |

```html
<html lang="en" data-pe>
  <head><link rel="stylesheet" href="apps/web/src/base.css" /></head>
  <body><div class="page-wrap">…</div></body>
</html>
```

`data-pe` goes on `<html>`, not on `<body>`: the defaults are written `[data-pe] body`. Standalone
pages reach a role by `var(--pe-ink)` and get no utilities, because `@utility` needs the Tailwind
build. In app TypeScript the rule inverts: a bare `var(--pe-*)` is a hard zero, and `lib/token.ts`
is the one reader for a value no utility can express.

## The 17 roles

Read as a Tailwind colour: `text-ink`, `bg-artifact`, `border-line-2`.

| Ladder | Role | Meaning |
|---|---|---|
| ground | `page` | the page ground |
| ground | `artifact` | the ground of a machine-operated object that carries state |
| ground | `recess` | a head or foot band inside an artifact |
| ground | `select` | where you are; the only selection and focus fill |
| ink | `ink` | body text, and the locate mark where a fill cannot separate |
| ink | `ink-2` | a secondary machine fact: busy, advisory |
| ink | `ink-mute` | disabled, dropped, never checked |
| hairline | `line` | the quiet hairline |
| hairline | `line-2` | the firm seam |
| meaning | `pea` | the agent's mark: proposal ring, card edge (display rung, never body text) |
| meaning | `pea-ink` | the agent's identity as text, and the source of the pea wash |
| meaning | `alarm` | the model disagrees |
| meaning | `caution` | staged failure, error, stale |
| meaning | `done` | it landed |
| meaning | `commit` | the fill of a verb that writes beyond the page |
| meaning | `on-commit` | text standing on a commit fill |
| meaning | `nav` | a link; blue text, byte-identical to `commit` |

`--viz-1..6` is a parallel palette for taxonomy and series. A viz colour never carries state.
`--pe-on` is the ground a child actually sits on; `--pe-veil` is the hover ink. Neither is a role.

## Type: 6 tiers

`t-caption` 10px · `t-label` 11px · `t-value` 12px · `t-prose` 13px · `t-title` 16px/600 ·
`t-display` 40px/600. Two modifiers ride on any tier: `face-mono` (the machine measured this) and
`t-upper`.

## Depth: 4 z rungs, no shadow

`z-raised` 10 · `z-sticky` 20 · `z-popup` 40 · `z-modal` 50. Depth is a ground shift plus a
hairline; `shadow-*` is a hard zero.

## Motion: one duration

`--motion` is 120ms. Every transition writes `duration-(--motion)`. No other `duration-*` passes.

## Composition utilities

| Utility | Job |
|---|---|
| `on-page` `on-artifact` `on-recess` `on-select` | set the background AND `--pe-on` in one class |
| `veil` | the hover ink, composited over whatever fill the control already carries |
| `hairline` | the 1px `line-2` inset edge of an artifact frame |
| `alarm-wash` `pea-wash` `caution-wash-artifact` | the three sanctioned tints |
| `seam-border` | a dashed edge; it means SEAM and nothing else |
| `locked` `unsaved` | italic for locked, bold for unsaved |
| `squiggle` + `-drift` `-stale` `-unverified` `-unsettled` | rank a value you distrust |
| `ghost-drift` `citation` `tag` `spin` `prose-pe` | struck ghost, cited value, uppercase key, busy, long prose |

If you set `background`, set `--pe-on` on the same rule. The `on-*` utilities do both for you.

## The six laws

1. **One alarm.** `alarm` means "the model disagrees". Nothing else may wear it.
2. **Pea is never blue.** The agent's proposals wear the agent's identity.
3. **Selection and focus are a fill, never a hue.** Only `select`.
4. **The only filled blue writes beyond the page.** `commit` fills; `nav` is text; nothing else is blue.
5. **Mono means the machine measured this.**
6. **Bold is reserved for unsaved**, everywhere, always.

Rider: a meaning colour on a fill smaller than a word needs a second channel, because pattern,
weight, outline or position must carry the distinction too.

A new role, tier, or rung is a ruling in `docs/features/design-system/LEDGER.md` plus a guard
change in the same commit. No route invents one.

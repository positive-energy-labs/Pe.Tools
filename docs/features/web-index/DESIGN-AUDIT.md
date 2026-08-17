# / (web index, the front door) — design-language audit

Recorded during the per-route design-system pass of 2026-08-16 (compressed — the route is
chrome plus one live verb). Governance: nothing under `components/`, `styles.css`, or
`design-lang.css` changed. Canon:
[`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md), `apps/web/src/design-lang.css`.
Format follows [`../takeoffs/DESIGN-AUDIT.md`](../takeoffs/DESIGN-AUDIT.md).

---

## A · State census

The page's only live state is the host-update flow; everything else is navigation.

| # | state | means | axis | outcome | rendered as, after the sweep |
|---|---|---|---|---|---|
| 1 | installed release known | machine-measured version | — | — | `FactChip` `vX.Y.Z` |
| 2 | update available | a commit is offered | — | — | the update `Verb` (commit) appearing |
| 3 | update in flight | install + host restart poll | — | `busy` ✅ | `Verb busy` ("update…") |
| 4 | updated, staged for next Revit | landed, with a caveat | — | `receipt` ✅ | `OutcomeLine receipt` + says-caveat |
| 5 | already current (409) | no-op | — | `advisory` ✅ | `OutcomeLine advisory` |
| 6 | update failed / host never returned | broken pipe, not disagreement | — | `error` ✅ | `OutcomeLine error` |
| 7 | update check unavailable | can't even ask | — | `advisory` ✅ | `OutcomeLine advisory` (#2) |
| 8 | web bundle identity ("update proof 0.6.22") | which deploy you are looking at | — | — | mono caption in the hero eyebrow (kept — it is a proof-lane marker) |

**Reachability law (§0), verified against `src/routes/` at audit time:** every living route has
a card — `/family`, `/chat`, `/families`, `/takeoffs`, `/settings`, `/doc-lab`, `/ops`,
`/schedule-grid`, `/data-tables`, `/parameter-links`, `/instances`, `/design-system` — and the
four design-system satellites (`/proposal-flow`, `/arming`, `/popovers`, `/swatch`) now have
direct nav links under the design-system card (previously reachable only through
`/design-system`'s own footer, i.e. two hops and easy to rot). No card points at a deleted
route.

## B · Findings

### 1 · Nav cards are enclosed plain content — the border budget has no nav-card form

The tool cards are `ui/card` borders around stateless navigation — exactly what "plain content
is never enclosed" forbids, and `ArtifactFrame` (rightly) refuses to serve. But a front door of
twelve unbounded prose blocks has no scannable shape either; the language has verbs, chips,
frames, and rails — no *navigation surface* form. Kept on `ui/card` deliberately (alien chrome
beats a misused frame) and named here: the front door needs a ruled shape before `ui/card` can
die. Hover now buys no hue (the veil replaces `border-primary/40 bg-accent/30`), and the one
blue on hover is `--r-nav` text on the arrow — nav's legal spend.

### 2 · "Update check unavailable" conflates three different truths

The advisory renders whether the endpoint 500'd, the network died, or the dev proxy lacks the
host — three different stories, one line, because the query surfaces one `error` string. The
honest fix is upstream (the `/host/update` contract distinguishing them), not in chrome.

### 3 · The brand lamp is decoration wearing a state slot

The header's dot next to "Positive Energy" was `bg-primary` (the commit blue as a logo). Moved
to neutral ink — but a colour-shaped dot beside a name still *reads* as a status lamp (the
instances route uses exactly that shape for liveness). Either the front door earns a real lamp
(host connected?) or the dot should go. Left as neutral ink pending that call.

## C · What migrated

| | count | notes |
|---|---|---|
| `Verb` | 1 | update (commit — installs beyond the page; busy label built in) |
| `FactChip` | 1 | installed version |
| `OutcomeLine` | 4 | receipt, advisory ×2, error (replacing four tone-picked `<span>`s incl. `text-destructive`) |
| reachability | +4 links | design-system satellites now one hop from the front door |
| type tiers | all | `text-[0.7rem]`, `text-xs/sm/base/lg/5xl` → `t-caption/t-label/t-value/t-prose/t-title/t-display` × `t-upper` × `face-mono` (proof marker) |
| hue discipline | 4 sites | `bg-primary` lamp → ink · `hover:border-primary/40` → veil · `group-hover:text-primary` → `--r-nav` · icon tile `bg-accent` (the select fill as decoration) → `--r-recess` |

**Raw-palette spends removed:** `--primary` as decoration/hover ×3, `--destructive` as error
text, `bg-accent` as tile fill. **Shim lines deleted from `styles.css`: none** (all tokens keep
consumers elsewhere). Remaining `ui/*` here: `Card` (finding #1), `ThemeToggle` (its own
`ui/button` import is outside this pass). `ui/button` imports in this route: 0 (was 1).

**Files touched:** `routes/index.tsx` only.

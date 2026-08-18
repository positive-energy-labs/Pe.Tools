# web-index ledger

## Decided
- 2026-08-16 — Nav cards stay on `ui/card` deliberately: enclosing plain content is forbidden and `ArtifactFrame` rightly refuses to serve, but twelve unbounded prose blocks have no scannable shape. Alien chrome beats a misused frame until the front door earns a ruled navigation-surface form.
- 2026-08-16 — Hover on a nav card buys no hue (veil replaces `border-primary/40 bg-accent/30`); the one blue is `--r-nav` text on the arrow — nav's legal spend.
- 2026-08-16 — The bundle-identity mono caption in the hero eyebrow is kept: it is a proof-lane marker (which deploy you are looking at), not decoration.
- 2026-08-16 — Reachability (§0) verified against `src/routes/`: every living route has a card, and the four design-system satellites (`/proposal-flow`, `/arming`, `/popovers`, `/swatch`) got direct nav links instead of being two hops deep inside `/design-system`'s footer, where they rot.

## Tried & rejected
- 2026-08-16 — `bg-primary` brand lamp beside "Positive Energy": the commit blue used as a logo. Moved to neutral ink — but a colour-shaped dot beside a name still reads as a status lamp (instances uses exactly that shape for liveness).

## Owed
- Decide the brand dot: either the front door earns a real lamp (host connected?) or the dot goes. Neutral ink is a holding position.
- "Update check unavailable" conflates endpoint 500, dead network, and a dev proxy with no host into one advisory because the query surfaces one `error` string. Honest fix is upstream in the `/host/update` contract, not in chrome.
- Front door needs a ruled navigation-surface form before `ui/card` can die here.

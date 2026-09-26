---
name: page
description: "Disposable HTML as a working surface between agent and user: explain a system, review claims on a picture, compare variants, or test an interaction model. Trigger on \"make me a page\", \"html\", \"interactive diagram\", \"diagram this\", \"explain it visually\", \"scratchpad\", \"throwaway page\", \"disposable html\", \"mock it up\", \"something I can click\", or when a reply would otherwise be a wall of text about a system, a set of places, or a choice. Not for settling a product surface on real primitives; that is `protoui`."
figure: the orrery, not the painting — a page that holds state and turns
scope: skills
---

# Page

**Build the orrery, not the painting.** A painting of the planets is admired once. An orrery is turned: the user moves one wheel and every body answers, because the gears are real. A page without state is a painting, however good it looks, and the user judges function over form.

**The page is a letter that expects a reply.** It carries the question, the evidence in place, and the envelope back. A page the user cannot answer from is a poster.

## Kit

Start from a template in `kit/`, never from a blank file. `kit/index.html` is the gallery.

| Template | Use it to | Proven on |
|---|---|---|
| `kit/review.html` | put claims on a picture and collect verdicts per place | `.artifacts/poc-feedback/` (rooms feedback, V5 and V6) |
| `kit/diagram.html` | explain a system: owners, flows, a step-through | `.artifacts/poc-flow/sot-scratchpad.html` |
| `kit/lineup.html` | compare variants of one thing and collect numbered rulings | the poc-feedback index |
| `kit/sandbox.html` | test whether an interaction model holds, by firing events against invariants | none yet |

`python kit/build.py <template> <data.json> <out.html>` fills the template's data block from real artifacts. `kit/check.py <page>` renders it headless, fails on any script error, and runs the page's own `window.__walk()`.

## Laws

- Data is replayed, not typed. A build script fills the page from real artifacts, so the page regenerates when the data changes. Hand-typed or invented data carries a visible "stand-in" mark on the page.
- State is one pure `reduce(state, event)`. Everything visible derives from it, the URL carries the view state, and every user act is an event in a log. A page with no reducer is a picture: ship an image instead.
- Every thing the page names is locatable on the page: an id the user can search, a coordinate readout, a link that focuses it. A size or a callout number from another message is not a location.
- A page that asks the user anything has one export. The export writes a typed file the agent reads, and the page shows what the agent will do with it.
- Use the product's real rules and messages where they exist. A refusal the product would give appears word for word.
- Show state as a glyph and a colour, and put explanations in hover text. A card is a picture, a glyph, one line, and its verbs. A verb sits on the thing it changes, and an impossible verb is hidden, not greyed.
- A decision ships as a numbered rulings sheet with copy-as-markdown. Returned rulings go to the ledger `docs` names, the same turn.
- Report a page only after `kit/check.py` passes. Say what the walk did not cover, and say that nobody has clicked it by hand yet.
- Put the page under `.artifacts/<topic>/`. It is thrown away; a winner is rewritten on real primitives by `protoui` and `close`, never promoted.
- Open the page for the user and give its absolute path in a code block.
- Refuse the page when the demo would have to reimplement the product's own live state beyond a pure function or two. A faithful fake of a complex surface costs more than the real route, and a partial one misleads. Prototype on the route with `protoui` instead.

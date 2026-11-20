# Driving Pe.Tools

How a person or an agent uses the product on a real model to find out whether it works. Two readers: the owner's cold start, then the rules an agent driver adds. Each product's own card is `ts/products/<name>/DRIVE.md`, beside its journey script, so a run on one product reads one card. Project-specific cases (models, views, fan tags, measured seconds) never go in git; they live in the private `pe-drive-witnesses` pod, and this file and the cards name cases generically.

## Owner cold start

1. **Serve the checkout.** From `ts` in the checkout you mean to drive: `vp run dev`. Open the web app at `http://localhost:5175`, or the dev tray's PWA.
2. **Get a Revit.** Usually: ask Pea to start it. From main you may instead start one with `pe-revit session start` yourself; `/open` is the third door.
3. **Open the model.** The owner usually drives the live project and never syncs it. That is the owner's call and the owner's risk; an agent never does it (see below).
4. **Check what you are on.** Today you cannot, from the product: nothing shows the checkout a dev build serves, and the document targeting has been hard to read since the Situation head went. Owed in `docs/features/design-system/LEDGER.md`; until then, know which checkout you ran `vp run dev` in and which document you opened.
5. **First read in each route.** OPEN: the minimum read-only observation per product that says first use worked before anything is staged; each card holds its own.
6. **Stopping partway.** OPEN: what to leave running, what to close, and how to see whether Work stayed staged or a write landed.

## Agent drivers

Everything above, plus:

- **Never the owner's things.** Not the owner's Revit, dev server, ports or product home, and never the live project. Isolation is what high-volume driving needs, not a law: when the owner asks to watch, an agent may drive in the owner's Revit with a visible Chrome, saying so in its brief. Otherwise an agent drives a disposable copy in its own controlled session and isolated product home, started by `python tools/acceptance.py setup`, which records the owner's processes and ports at setup and refuses to touch them. Add-ins off in every Revit it starts, through every door.
- **Rows before driving.** A brief is a file in the run folder: rows, each with its fail condition written first, an estimate, a time box and a stop condition. Check that the case exists before driving it. Write each row as it finishes.
- **Off the happy path by habit** (`prove`, Drive as a user): second writes, double clicks, leaving mid-action, wrong inputs. A found defect seeds the next drive of its neighbours.
- **Pea in a person's words.** A prompt that names Pea's tools tests the prompt.
- **Watch, count, then compare.** Arm a page observer before the real click; count natively what should qualify, then match every offer on screen to that count; prove "nothing was sent" by reading the receiver before and after.
- **Shrink the case until it finishes** and stamp only what the small case covers; say when a substitute case was used; report the window and chat-pane width and the longest stretch with nothing changing on screen.
- **Reset cheaply.** Close and reopen the copy, discarding changes, before reaching for a new setup.
- **Tear down through the tool** and read `ev/teardown.json` for what is actually left; copy evidence the teardown deletes first.
- **Scale.** Driving scales with the change. No full pass of every journey and no installed drive unless the plan names a release. A missing drive does not hold a merge. The driver never runs tests.

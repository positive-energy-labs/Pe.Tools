# Segment brief template

Copy this file to `<workspace>/BRIEF.md` and fill in the bracketed parts. Each segment agent's prompt then needs only its window, its sheet range and anything known to fall in its window.

---

[Who presented what, which tools were on screen, who the domain experts are. One paragraph.] The goal is one coherent debrief with **screenshots for every moment someone refers to something on screen**: several per moment, because gestures lead and trail the words. The transcript is lossy. The video is ground truth for what was shown.

You own one time window. [N] agents run in parallel; a merge agent reads every segment later.

**Files** (in the workspace):
- `transcript.txt`: verified, timestamps relative to the video.
- `notes.md`: the user's notes. Its **Corrections** section overrides everything.
- `primer.md`: written from code. Its UI descriptions are hypotheses to confirm.
- `video.mp4`.
- `frames/f_NNNNN.jpg`: second NNNNN-1.
- `sheets/sheet_NNN.jpg`: 80 s each, 5 s tiles. Scan these first; they are cheap.

**Geometry:** the share sits at about [x..x, y..y]; a webcam tile may cover [..]. Crop and upscale before reading text (command in the workspace brief). Check the layout, since the presenter can change.

**Method:**
1. Read your transcript window, plus 60 s on each side.
2. Scan your sheets for screen changes.
3. Find every on-screen moment:
   - spoken deixis ("this", "here", "look at");
   - numbers read off the screen;
   - visual acts with no words (cursor circling, selections, drawing, typing);
   - meaningful screen changes the transcript is silent on.
4. Per moment, check the 1 fps frames from -6 s to +6 s, and extract sub-second stills where the cursor moves. Keep 2–5 stills (lead-up, gesture, after) plus a zoom crop when the subject is small, named `shots/S<n>_<hhmmss>[a-e][_zoom].png`. Never use a shared temp name.
   - A still earns its place by showing the subject. Cameras-only, lobby and settings screens get no stills; quote the line instead.
   - A zoom crops to the subject (a cell, a field, a label) and upscales it until the cited value reads at a glance. A whole share enlarged is not a zoom.
   - Each still's caption says what it shows, in at most 12 words ("F30 formula `=E30+E28-0.045`, cursor in the cell"). Never use a template caption.
   - Never sample stills on a fixed time grid.
5. Read what is on screen (route, panel, selection, values, colours, errors), and name what you could not read.
6. Keep SAID, SHOWN and INFERRED apart. Flag mis-hearings the screen corrects.

Budget: about 70 images read in full.

**Output** `segments/S<n>.md`:
```
# S<n> — <start>–<end>
## Topic blocks        (time range, who, discussed, shown, decisions/claims attributed, disagreements, open questions)
## Moments             (id S<n>-M<k> | visual vs spoken time | speaker | verbatim quote | on screen | shots with 1-line captions | confidence)
## Action items        (owner | item | evidence times | said vs inferred | confidence)
## Product feedback    (every complaint, confusion, workaround or request, small ones included, attributed and timed)
## Bugs observed on screen (discussed or not)
## ASR corrections & glossary findings
## Transcript gaps     (screen activity with no transcript)
## Hits on the user's notes (matches and contradictions)
```
Every claim carries a timestamp. Final message: the path, the moment and shot counts, and the 3 most important findings, in at most 8 lines. Write only inside `shots/` and `segments/`.

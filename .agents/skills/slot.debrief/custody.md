# Custody and records mechanics

Proven on the 2026-11-03 Revit Development Meetup debrief: 1:49 of Zoom at 720p, 6,563 frames, 83 sheets, a clock residual of about ±2 s.

## Transcript and video (Fireflies)

- Fireflies is reached through Executor: `tools.fireflies.fireflies_fetch({ accountId, input: { id } })`. Find the account id with `search({ query: "fireflies" })`. The meeting id is the tail of the `app.fireflies.ai/view/<title>::<id>` URL.
- The returned text holds `Sentences:` lines `[m:ss - m:ss] Speaker: text`, plus `Video Url:` and `Audio Url:`. Those are signed CDN links, valid for about a year; download them with `curl -L`.
- Shorten speaker names to codes inside the executor program, then copy the transcript to `transcript.txt`, with a legend header naming each code.
- Verify the copy: return `sent.map(l => l.length).join(",")` from executor and compare it with each local line's `len(line.encode('utf-16-le'))//2`. The run passes only at 0 mismatches.

## Frames and sheets

```bash
F="fontfile='C\:/Windows/Fonts/arial.ttf'"
ffmpeg -v error -i video.mp4 -vf "fps=1/5,scale=480:-1,drawtext=$F:text='%{pts\:hms}':x=4:y=4:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.7,tile=4x4" -q:v 4 sheets/sheet_%03d.jpg &
ffmpeg -v error -i video.mp4 -vf "fps=1,drawtext=$F:text='%{pts\:hms}':x=w-tw-6:y=h-th-6:fontsize=16:fontcolor=yellow:box=1:boxcolor=black@0.6" -q:v 3 frames/f_%05d.jpg &
wait
```

- `f_NNNNN.jpg` shows second NNNNN-1. Sheet N covers seconds (N-1)×80 to N×80.
- Run this in the background: about 600 MB and several minutes for two hours of video.
- Read one full frame and record the share rectangle, plus any webcam tile that covers it. At 720p the share was x 100–1200, y 60–676. UI text needs a crop plus a 2× lanczos upscale, extracted straight from the video:

```bash
ffmpeg -v error -y -ss 813.5 -i video.mp4 -frames:v 1 -vf "crop=1100:616:100:60,scale=2200:-1:flags=lanczos" shots/S1_001330a.png
```

## Records

Read only. Copy any locked sqlite before querying it. Census each source, including the empty ones:
- **Product runtime:** `%LOCALAPPDATA%\Positive Energy\`, which holds host logs, request logs, persisted Work and state (edits carry revisions and timestamps) and the install root.
- **Revit journals:** `%LOCALAPPDATA%\Autodesk\Revit\Autodesk Revit 20xx\Journals`, for document opens, dialogs and stuck add-in prompts.
- **Browser history:** report only meeting-relevant URLs and titles.
- **Agent sessions active in the window:** Claude, Codex and T3. Grep by timestamp.
- **Other:** `git reflog`, Downloads, Zoom local data (usually encrypted), Excalidraw scenes (a live room leaves no saved scene).

Good clock anchors are user acts that both the screen and a log record: a typed URL, a criteria edit, a document open, a page load. Two anchors give the offset; four that agree within 1.5 s make it solid.

## Model grounding

- Saved snapshots and scene metadata (`.artifacts/accept/*/wire/metadata.json`, handles carry `bounds`) answer identity, topology and position without Revit. Note each file's date: a snapshot can predate the meeting, and elements missing from it signal drift.
- A live read uses only `pe-revit` (see the `execute` skill), with read-only scripts. Discard on stop and confirm `session list`. A session read after the meeting is stamped "post-meeting".

## Talk resources

Proven on three Autodesk University classes, 2026-11-04:
- The class page lists its files (presentation, handout, and sometimes a materials ZIP) as `https://static.au-uw2-prd.autodesk.com/<name>`. A direct page fetch can return access-denied; search-indexed copies of the page still name the file URLs.
- The recording is a Brightcove player: `yt-dlp --write-subs --sub-langs en "https://players.brightcove.net/<account>/default_default/index.html?videoId=<id>"` gets the video, the English `.vtt` captions and `info.json`. Captions are machine-made, so expect mis-hearings, just as in Fireflies.
- Record each file's URL, size and SHA-256 in `manifest.json`. CRC-check archives, and read sample scripts and models without running them.
- Render every page, then build one contact sheet per document so a reader can scan it:

```bash
pdftoppm -r 75 -png handout.pdf pages/handout     # pages/handout-NN.png
magick montage pages/handout-*.png -tile 8x -geometry +4+4 sheets/handout.png
pdfimages -list handout.pdf | tail -n +3 | wc -l   # embedded screenshots: a high count means the text extraction misses most of the page
```

Re-render a gem page at `-r 150` and crop it for the deliverable.

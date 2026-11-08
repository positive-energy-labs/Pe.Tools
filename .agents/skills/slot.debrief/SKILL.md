---
name: debrief
description: Turn a recording into a grounded debrief, where every claim points at a timestamp, a screenshot, a page, a model element or a machine record. Two modes. A meeting of ours ends in a short sheet the user rules on. An external talk (a class, webinar or vendor demo) ends in a watch-or-skip page that harvests what our code does not know yet. Trigger on "debrief", "scrape this meeting", "meeting recording", "fireflies", "review the call", "meeting feedback", "what did we decide in the meeting", "is this worth watching", "watch these videos", "autodesk university", "webinar", "conference talk", "anything special for our product", or when a recording, transcript, class link or meeting link arrives with context to reconcile. Not for agent session history; that is `mine`.
figure: the accident investigator who reads the voice recorder against the flight data and the wreckage
prevents: "the summary: a recording remembered as prose nobody can point at"
scope: repo
---

# Debrief

**Be the accident investigator.** The voice recorder (the transcript) says what people *said*. The flight data (frames, logs, the model) says what *happened*. Read each against the other. A transcript is **testimony**: lossy, mis-heard and late. A frame, a log line, a model element id or a submittal page is an **exhibit**. Every line of the debrief carries an exhibit, and testimony without one is marked as testimony.

**Thoroughness is the product.** A debrief is worth the legwork behind it: every on-screen moment found, every element resolved, every complaint tabled. The user should never polish it into shape afterwards. Land it concise in prose and dense in exhibits on the first pass.

The workspace is `.artifacts/meetings/<YYYY-MM-DD>-<slug>/`. Each step writes its file there, so a crash or an interrupt loses one step, not the run.

## Pick the mode

| | **Meeting** (ours: colleagues, experts, our tools on screen) | **Talk** (external: a class, webinar, vendor demo or conference session) |
|---|---|---|
| Question | What was said, decided and complained about, and what does the user rule on? | Is it worth watching, and what does it know that our code doesn't? |
| Steps | 1–9 below | [Talk mode](#talk-mode) |
| Deliverable | REPORT, MOMENTS, rulings sheet | `watch-or-skip.md` |

A talk the user's own team gave internally is a meeting. When the user names several recordings, run one workspace per recording and one shared deliverable.

## Steps

Steps 1 and 2 come first. Then 3, 4, 5 and 6 run in parallel as delegated agents. Steps 7 to 9 follow in order, and you own them.

1. **Custody.** Get the raw record on disk, verbatim and checkable. *Done when* all four are true:
   - the transcript is on disk, with every line verified against the source;
   - the video is on disk;
   - there is one frame per second with the time burned in, plus contact sheets;
   - the screen-share rectangle has been measured on one full frame.
   Mechanics: [custody.md](custody.md).
2. **Primer.** A delegated agent reads the code, the feature ledgers and any attached threads, and writes `primer.md`. It covers what the product is, its surfaces, the glossary and what is in flight. Every claim is tagged SEEN-IN-CODE (with path), CLAIMED (with pointer) or INFERRED. *Done when* the primer exists before any segment agent starts. Segment agents read UI against it as hypotheses.
3. **Segments.** Write one shared brief to disk ([segment-brief.md](segment-brief.md)). Fan out one agent per 15–20 minutes of video. Each writes `segments/S<n>.md` and its stills. *Done when* every window has every **on-screen moment**: deixis in speech ("this", "here", "look at"), numbers read off the screen, and visual acts nobody spoke about. Each moment has 2–5 stills (lead-up, gesture, after) and a zoom crop when the subject is small.
4. **Records.** A delegated agent corroborates the meeting against the machine. *Done when* all three are true:
   - the video's wall-clock start is derived from at least two independent anchors, with the residual stated;
   - every source is censused, including the empty ones;
   - every record is placed on one timeline against the segment moments.
   Sources: [custody.md](custody.md#records).
5. **Ground.** A delegated agent resolves every model element named in the meeting. That means element id, mark, family : type, category, system, connections and flow. *Done when* every name is resolved or listed as unresolved, and each fact is stamped with its lane.
   - Use saved snapshots first. Saved scene metadata carries per-element bounds, which settles order and position without Revit.
   - Open a controlled session only when the snapshots cannot answer and the user has authorized it. Stop that session, and confirm with `pe-revit session list`.
   - **Replay our product's numbers.** When the meeting read a number off our product, or set it against an expert's number, re-run the shown inputs through the product's own code, then diff the result against the frame. A URL in the address bar often carries the whole state. Use the deterministic lane: call the function with those inputs, with no server and no Revit. A re-derivation in another language is testimony about the code, not a replay.
   - A browser replay, a dev server or a Revit session needs the user's go. Revit is expensive to start, and this machine usually carries live dev work that a new session can collide with.
6. **Expert knowledge.** A delegated agent reads the **whole** transcript, not the segment summaries; nuance dies in summaries. It writes `expert-knowledge.md`. *Done when* all of these are true:
   - every rule the domain experts taught has a verbatim quote and a timestamp;
   - every rule is tied to the concrete elements it was about;
   - the worked numbers they used are test cases (inputs, expected output, source time);
   - each conflict is kept open, with the one question that settles it.
7. **Merge.** A delegated agent writes `REPORT.md` and `MOMENTS.md`, and a second sweep tables **all** remaining small feedback. Shapes: [artifacts.md](artifacts.md). *Done when* all of these are true:
   - every image path and anchor resolves;
   - the text lint finds nothing (see [artifacts.md](artifacts.md#text-lint));
   - every action item cites an exhibit;
   - no corrected claim survives.
   One script checks the first two.
8. **Judge against the code, when it applies.** This step runs only when the meeting gave product feedback, meaning complaints, bugs or requests about our tools. A meeting of another kind (training, design review, planning) skips it and says so in one line.
   - Judge against the code the feedback will land on: a pending branch through `git show <branch>:<path>`, otherwise HEAD. Never use the working tree.
   - Give each item one verdict: FIXED, MOOT, STILL-NEEDED, SUPERSEDED, REJECTED, or OPEN(who). Drop items the code already settles.
   - *Done when* every product item has a verdict and an anchor.
9. **Rulings sheet.** Write `corrections-explained.md` for the user. Shape: [artifacts.md](artifacts.md#rulings-sheet). *Done when* each ruling fits in a few plain lines with its screenshots and links, and the user can answer with something like `1A 2A 4B`.

Close with the landing in the next section.

## Talk mode

**Be a scout, not an auditor.** Ask "what could we take from this?", never "does this make us redundant?" Doubt still applies to *claims* ("Revit can do X"); it never applies to *ideas*. An idea is cheap: write it down, label it IDEA, and let the user throw it out. "Already owed in our ledger", "deferred" and "outside scope" are reasons to show an item, not to close it: a talk that does what we owe is a working spec.

1. **Custody.** Get every published resource: the recording, captions, slides, handout and materials archive. Render **every** slide and handout page to an image and look at each one. Text extraction is only an index, and handouts are mostly screenshots of dialogs and settings. Frames and contact sheets follow [custody.md](custody.md), plus [talk resources](custody.md#talk-resources). *Done when* every resource is on disk, every page is rendered, and the transcript is timestamped. If the user named a start time ("around/after 20 mins"), the window starts there, but read past its edges.
2. **Primer.** As in meeting mode, scoped to the product the user named.
3. **Harvest.** Delegate one agent per 15–20 minutes of video, plus one per document. Each lists **everything** shown or written, each with a page or timestamp and a still: every technique, dialog, setting, option, parameter, schedule field, report column and workflow trick. Each item gets one line, "for <our product> this could mean …", and one tag:
   - **NEW**: our code has nothing like it;
   - **KNOWN**: our code already does it (link the file and line);
   - **OWED**: our ledger owes it, and this is a reference for it;
   - **CONTRADICTS-US**: one of our docs or claims doesn't hold for this version (link the line);
   - **IDEA**: a speculative use, labeled as such.
   *Done when* every page and every minute of the window has been looked at, and each item carries an exhibit.
4. **Judge against our code**, always: this mode exists to find the gap. Read HEAD, never the working tree. Sample files and scripts from the talk are read, never run.
   - **Check the user's premise first.** The talk's words can name a different thing than ours ("Systems Analysis" in a 2020 class meant EnergyPlus loads, not duct pressure), and the user's recollection of a ruling can be older than the ledger. Say which, in the verdict's first lines.
   - **Read the speaker's published source** when the talk links a repo. Pin the tree and cite lines against ours. In a 2026-11-04 trial this produced the run's best finding: a spatial index built once, set against our per-open-end collectors.
   - For each NEW or CONTRADICTS-US item, run `revit_docs_search` (`help` for the newest year, plus `blog` and `tbc`) to see whether the platform documents it, and link the hit.
   - Search `au` for neighbouring classes the user didn't name, and list the best ones as "also worth a look".
   - Without the Pea tool (a Codex or plain shell thread), call `revitDocsSearch.execute` from a `.mts` script in `.artifacts/tmp`, as in `ts/packages/mcps/tests/autodesk-docs.live.test.ts`. A `.ts` script fails on `@pe/browser`'s ESM export.
5. **Deliverable.** Write `watch-or-skip.md` ([shape](artifacts.md#watch-or-skipmd)), led by the verdict and the gems, each gem with its picture.

Worked example (2026-11-04, three Autodesk University classes): the agent listed the 2024 handout's sizing dialog (pp. 8–9), System Inspector and balancing (pp. 14–20), and conditional-format schedules with Highlight in Model (pp. 25–30). It then closed each with "deferred", "already owed" or "outside scope", and showed none of their 183 screenshots. Those pages were the gems the user wanted.

## Corrections

The user's word outranks every exhibit. When the user corrects anything (a mis-hearing, which model was used, what a note meant, a calculation):
- append it at once to a **Corrections** section in the workspace notes file;
- relay it to every running agent;
- re-check every artifact for the corrected claim before you report.

Precedence when sources disagree: user corrections, then machine records and live model data, then the video, then the transcript, then agent inference, then any vendor summary. A conflict is shown with what would settle it; it is never smoothed over.

## Fireflies [scope: repo]

What a Positive Energy meeting looks like through Fireflies (proven 2026-11-03):
- **Access:** the Executor app `fireflies`, with one linked account. Find the tool paths and account id through Executor `search({ query: "fireflies" })`. Executor can drop mid-session and its tools vanish; look again with ToolSearch. Signed media URLs fetched earlier keep working.
- **Reads:**
  - `fireflies_fetch` returns the whole record: metadata, speakers, `Sentences:`, and signed `Video Url:` / `Audio Url:`.
  - `fireflies_get_summary` gives Fireflies' own AI overview and action items.
  - `fireflies_get_transcripts` and `fireflies_search` find meetings by keyword, date or participant.
- **Writes:** `create_soundbite`, `share_meeting`, `update_meeting_privacy`, `move_meeting`, `update_meeting_title` and `revoke_meeting_access` change things other people see. They run only on the user's explicit ask.
- **The recording:** a Zoom bot capture, 1280×720 at 20 fps, about 150 MB for 110 minutes. A screen share fills only about 1100×616 of the frame, with a webcam tile over its top-right corner, so UI text needs a crop and upscale. Talk usually starts a few minutes in.
- **The transcript:** about 1,460 sentence lines per 110 minutes, timestamped relative to the recording start (aligned with the video to within a second). Lines are fragmented. Speakers are Zoom display names, and an occasional line is attributed to the wrong person. The screen settles who spoke.
- **Domain mis-hearings:** expect them on Pe and HVAC vocabulary. Seen so far:
  - "Mega Bear" = makeup air
  - "P zone" = the Pea pane
  - "P drop" / "P workflow" = Pea
  - "Morex" = Mortex
  - "D who" = DEHU
  - "crv" = ERV
  - "Matics" = schematic
  - "Chad's" = Chadds Ford
  - "flu" = flue
  - "poor 8 inches" = 0.8 in-wg

  Add new ones here when the user corrects them.
- **The summary** is testimony at the lowest precedence. It repeats the mis-hearings and invents tidy action items. Use it to orient, never as an exhibit.
- **Privacy:** meetings name clients under NDA. Evidence stays in the gitignored workspace, and nothing is published without the user's say.

## Landing

- The rulings go to the feature ledger the `docs` skill names, once the user rules. Ask before editing repo docs.
- Stop every session, agent and watcher this run started. Offer to delete the bulk evidence (`frames/`, `sheets/`, the video); keep `shots/` and the markdown.
- Stamp each headline claim per AGENTS.md. Frame readings are SHOWN; transcript lines are SAID.

## Footguns

- Executor tool results cannot be written to disk from inside the executor sandbox. A transcript copied by an agent must be verified per line: compare the source's UTF-16 line lengths against the file, and expect 0 mismatches.
- On Windows, ffmpeg's `drawtext` needs an explicit `fontfile='C\:/Windows/Fonts/arial.ttf'`. Git Bash's `/tmp` is not visible to Windows Python; pass `cygpath -w` paths.
- Parallel agents that share a temp filename overwrite each other's stills. Each segment prefixes everything it writes with `S<n>_`.
- A subagent can be refused a file write ("return findings as text"), and its output file may be empty. Capture the returned text and write it yourself.
- A segment agent reads a document picker or a blurry label as fact. Cross-check names against the records timeline and the user's corrections before the merge.
- The Zoom pen trails speech by up to 30 s, and gestures can lead it. Pick stills from both sides of the quote.
- Some agents write prose with the space before a number dropped ("At900 CFM", "isMaddox"). A PowerShell write can also turn curly quotes into `?`. Both passed a links-only check on 2026-11-04. Write every file as UTF-8, and let the text lint fail the merge.

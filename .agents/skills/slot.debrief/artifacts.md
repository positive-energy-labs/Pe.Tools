# Artifact shapes

The 2026-11-03 debrief landed on these three shapes after a polish round with the user. Write them this way the first time. Throughout: plain words, short lines, many images, links to every source, and the exhibit beside the claim.

**State each claim once, plainly, with its exhibit.** Proof stamps, residual doubts and "never verified" lists go in the Provenance section and nowhere else. A body sentence never carries hedges like "a candidate explanation, not identification of…", and a Confidence cell holds High, Medium or Low only. The 2026-11-04 run was rigorous and still read as a legal brief because every sentence carried its caveats.

## REPORT.md

Readable top to bottom in about 15 minutes.

1. **Header:** who, what, the clock offset, how to read it (SAID / SHOWN / INFERRED, the precedence order), and links to MOMENTS.md and expert-knowledge.md.
2. **TL;DR:** about 10 numbered lines.
3. **Action items:** one table per group: bugs in the shipped version; requirements and semantics; checks to build; picture/UX (framed as questions with options, not verdicts); model findings for the design team; questions for each expert; questions for the user. Each row has these columns:
   - ID;
   - owner;
   - an imperative action;
   - why, with exhibits (times, `MOMENTS.md#mNNN` links, shot paths, element ids, record lines);
   - done-when;
   - priority (now / next / later);
   - confidence.
4. **The ideas, organized:** one short section per idea, each with 1–2 inline screenshots and an italic caption giving the time and what it shows.
5. **Worked systems:** for each real model system discussed, an ASCII topology with element ids, what the experts said about it, and what the tool should show for it.
6. **Conflicts and open questions:** a table with the conflict, the sources on each side and what would settle it.
7. **Provenance:** lanes and custody, freshness, proof stamps for key claims, and a "never verified" list.

## MOMENTS.md

Build it with a script from the segment files, de-duplicated across segment boundaries. Each moment gets:
- the video time and the local wall-clock time;
- the speaker and the verbatim quote;
- what was shown;
- every still embedded in lead-up, gesture, after order, each with the segment's own caption saying what it shows (never a generated "exhibit 2/3" line);
- linked element ids and action-item ids;
- the corrected transcription, where a mis-hearing was fixed.

An anchor `## MNNN` per moment lets REPORT link to it.

## Rulings sheet

`corrections-explained.md`: the page the user actually rules from.

- **Top:** a resource list (transcript link, MOMENTS, REPORT, the rules file, element and record files) and a 3–5 term glossary in one paragraph.
- **One section per ruling:**
  - a plain-language title phrased as the question;
  - two or three lines: what was wrong or open, and the quote with its time;
  - one to three screenshots with captions;
  - links to the code or data it rests on;
  - lettered options in a quote block, with the recommendation marked `(rec)`.
- **Each option changes what gets built, checked or decided.** An option that only says to be careful ("compare with identical inputs", "confirm before deciding") is cut. If only one real option is left, the item is a note, not a ruling.
- **Rulings are the user's.** A question only an expert or the design team can answer goes in a short "Ask Hap" / "Ask the design team" list below the rulings: one line each, with its time and shot.
- **Bottom:** "Smaller feedback not in the report": one table of every remaining complaint, friction point, confusion and missing piece, with columns Time | Who | Feedback (≤15 words) | Kind | Shot link. Drop rows the pending work supersedes and list those drops in one line. A row whose exhibit cannot be found is dropped, not guessed.
- **Close:** the reply format (`1A 2A 4B …`) and an offer to expand any item.

Concise means few words per point, never fewer exhibits. When a section grows, cut prose before images or links.

## Text lint

The merge's check script fails on each of these, across every markdown file in the workspace:
- a letter run straight into a digit, outside identifiers and code: "At900", "versus1622.2". The regex `\b[A-Za-z]{2,}[0-9]`, outside code spans and with an allowlist of the meeting's real ids, catches it;
- a `?` directly before a letter, which marks a mangled curly quote;
- a U+FFFD replacement character;
- an image whose caption repeats word for word in another moment.

## watch-or-skip.md

Talk mode's one deliverable. If the user named several recordings, all of them go on one page, readable in about 5 minutes.

1. **Verdict:** one line per recording, Watch / Skim / Skip, with the exact time range and the reason ("37:44–46:49: per-leg loss overrides contradict WHY-NOT-REVIT reason 1").
2. **Gems:** the 3–8 items most worth the user's time, best first. Each gem gets a bold title, the page or time, a picture of the frame or page crop, two lines on what it is, and one line, "for <product> this could mean …", with its tag and a code or ledger link.
3. **Harvest table:** every remaining item, with columns Where (page/time) | What | Tag (NEW / KNOWN / OWED / CONTRADICTS-US / IDEA) | For us | Shot.
4. **Claims of ours it challenges:** each with our doc line, the talk's exhibit, and what would settle it.
5. **Resources:** links to the downloaded files, the transcripts and the contact sheets.

Same register as everywhere: plain claims, and caveats only in a closing provenance line. A gem without a picture is a defect.

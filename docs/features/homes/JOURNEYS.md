# Homes crusade journeys

The driver's journeys and the end-gate targets for the [Homes effort](LEDGER.md). Written 2026-11-11 at main a02b8aea. Each journey is frozen as data (a goal or prompt, a setup, steps, a pass witness, a lane, a fixture), not as a script, so the grader survives an engine change. Stamp for every journey: UNPROVEN[not run; the lane named in its record proves it]. Sources: `muse/round3/driver.md` and `muse/round3/journeys.md` under `.artifacts/runs/homes-crusade-20261111/`, as amended by `muse/POSITION-v3.md` and `muse/POSITION-v4.md`.

The driver starts at the kernel crusade's end gate. Until then this file is a plan. The driver owns the runbook that implements it.

## Rules for every journey

- A journey has about ten gestures at most, its own setup, and one witness. One broken journey must not starve the others.
- Before and after every write, the driver takes a native or byte snapshot of the subject. Every file write records the SHA-256 before, after, and after a restore.
- Every resolved identity and value records which home served it. A provenance witness is part of every journey.
- No endpoint call, DOM click or store setter stands in for a gesture. The first failure is preserved before any recovery.
- Every journey ships as a scripted runbook the owner can run. kaitpw: "the runbooks for these need to be captured and or scripted so I can run them eaily when that time comes".
- Journeys that need no Revit (H1 host half, H2, H4, H5) run on host-only lanes, so the Revit memory floor does not gate them. Revit journeys share one Revit drive per wave.
- The driver never copies a real home. Slice 0 hands it a small classed copy of the standards.

## Lanes

| Lane | What it is | Exists today |
|---|---|---|
| dev session | the driver's worktree at the candidate SHA, its own host and web, a controlled `pe-revit session`, a fixture model | yes |
| CLI | `pea --prompt` headless against the dev session, with a real provider key | yes, given a key |
| two hosts | two hosts and two user homes on one machine, with one mapped folder standing in for the firm home; no Drive sync | yes |
| Sandbox | Windows Sandbox with the candidate's installer and a clean profile; no Revit | partly; no per-wave candidate installer yet |
| second profile | a second Windows profile on the owner's machine with an installed build and Revit | no; the owner has not ruled it, and one Autodesk licence per named user is unproven |
| G: scratch | a scratch folder on the real shared drive, for Drive's own behaviour | allowed by kaitpw 2026-11-11; not created |
| coworker machine | a coworker's real machine | not in the end gate; a scripted runbook at the first real release |

## Fixtures

- **Detached Chadds clone**: `.artifacts/revit/detached/MEP_YoramLePairArchitects_ChaddsFord_R25_standalone_20261019.rvt`, present at 381,452,288 bytes on 2026-11-11. kaitpw: "its a throwaway clone so anyw rites are allowed." It carries MUAS-1, FC-11 and FC-23.
- **Cloud throwaway clone**: `chadds_clone_aug_11`. kaitpw: "we also have chadds_clone_aug_11 which is cloud and throwaway." It is the fixture for cloud, save and synchronize journeys. A local copy sits beside the detached clone as `MEP_Chadds_Clone_Aug_11_R25_local_20261028.rvt`.
- **The real Chadds model** is never saved or synchronized by any drive.
- **A local central** made from the detached clone in a controlled session, plus one local, for file-based worksharing.
- **A project folder skeleton**: the folder tree of the Chadds Ford Residence project folder with no files, under a mapped folder, with a `Pe.Tools` child.
- **A stand-in upload server** for the hosted parser.
- **Real old shapes** for H5: `PlumbEquip\HPWH.json`, an `OnFinishSettings`-era schedule, one truncated `pod.json`, one truncated standard, Work files from kernel drive gates 21afa61b, dfaed397 and bc40426c, and an old `providers.json`.

## Journeys

### J1. The MUAS-1 question, cold

- **Prompt:** "the makeup air unit MUAS-1 in this model is set to 900 cfm but rhvac only has like 150 going through it. which one is right? and how does it actually tie into the ERVs and fan coils? have we even looked at the spec sheets for this stuff"
- **Setup:** a source build, no `--allow`, no environment variable set by hand, the model not open. Pea opens its own document (kaitpw: "muas retest should also involve pea opening its document"). Three runs. Once with the firm API key and once with a personal subscription.
- **Steps:** one `pea --prompt` per run. No person present.
- **Answer key:** `.artifacts/runs/deterministic-20261030-muas-evidence/EVIDENCE.md` in the root checkout (present, 18,935 bytes). The key wins on any difference from the list below.
- **Rubric,** each item stated and cited with a path plus a page, cell or crop, or a URL that resolves: 900 is 450 plus 450 of fireplace makeup air; ASI 7 is ranked the newest issued document; the MUAS-1 schedule row is read as live; the FC-23 strike is reported with its ambiguity; the discharge feeds the RV-7 and RV-15 outside-air inlets and the FC-23 return; the fan makes about 0.97 in. of external static at 900; the heater drops about 0.18 in. and needs 675 cfm minimum; the louver drops about 0.03; the 10 in. duct runs at about 1650 fpm; the RHVAC file is binary and Pea says it cannot read it.
- **Pass witness:** in the transcript, 0 presses, 0 `permission_request`, 0 tool rows that blame the user or say "unsupported", 0 waits on consent. No uncited number. The model's native values are unchanged. The rubric score, the confident-wrong count, evidence reach and wall time are reported per run with their spread.
- **Lane:** CLI on a dev session. An installed-lane J1 is a separate run on the second lane, after the LiteParse binaries are bundled.
- **Fixture:** the detached Chadds clone; the project's documents on G:, read only.
- **Runnable today:** red on main by design. It depends on slice 3 and on three Ducts route defects owned by the ducts ledger.

### J2. A second person asks a follow-up the next day

- **Prompt:** "did anything change on MUAS-1 since ASI 7, and what's its external static?"
- **Setup:** a different user home, the same firm home and project home. J1 has run once as person A.
- **Steps:** one turn as person B.
- **Pass witness:** the answer matches J1 on every rubric item. Zero documents parsed in J1 are parsed again (hits by content hash). Zero drive-wide scans. Wall time is under a third of J1's.
- **Lane:** two hosts.
- **Fixture:** the detached Chadds clone; the project folder skeleton holding J1's derived files.
- **Runnable today:** no. Nothing a run learns is stored where a second person finds it (slice 9).

### H1. A fresh install finds the firm home and the standards with no environment variable

- **Goal:** "I installed Pea and our schedules and family profiles are just there."
- **Setup:** a clean profile with no `PE_TOOLS_*` variable in any scope. A mapped folder laid out as `04 PE Software Files\Pe.Tools` with the marker and the slice 0 classed copy. The candidate's installed build.
- **Steps:** install and census the environment; start the host and open the standards list; ask Pea "which schedule standards do we have?"; unmount the folder and restart.
- **Pass witness:** the host log has one line per home found, with its tier and how it was found. The list shows every ticked standard, including the HP schedule, with home "firm" and no `$schema` that names a server. Pea lists them by name and home. With the folder unmounted the host starts, the user home works, and a notice reads "firm home not found" with where it looked. A host that starts before its bundle exists and answers 404 counts as a failure.
- **Lane:** Sandbox for the host and web half. The Revit half needs the second profile or a coworker machine and is owed at the first real release.
- **Fixture:** the slice 0 classed copy.
- **Runnable today:** no (slices 0, 1 and 6).

### H2. A standard fix reaches a second machine

- **Goal:** "I fixed the HP schedule; Andrea gets it next time she opens Revit, without me sending a file."
- **Setup:** persons A and B on one firm home. B also holds a pod with the same id in the user home.
- **Steps:** A edits `MechEquip/HP.json` through the product and adds one field; B opens the standards list.
- **Pass witness:** the firm file's hash changes and the prior bytes are kept (H4). With no duplicate, B sees the field labelled firm, with A and the time. With the duplicate id, both pods are refused with one notice that names both paths, and B's way out is to fork under a new id or delete the copy. No user copy is made by any write.
- **Lane:** two hosts for the data path and the refusal. Drive sync latency and conflict copies need the G: scratch folder or a coworker machine.
- **Fixture:** the slice 0 classed copy.
- **Runnable today:** the data path only. The silent shadow was proven live by the kernel driver at dfaed397.

### H3. The project home is found from the model

- **Goal:** "When I open Chadds, Pea knows it's Chadds Ford Residence and uses that project's overrides."
- **Setup:** the detached Chadds clone; the project folder skeleton.
- **Steps:** open the clone, with no pointer, and read the Situation; accept the suggested bind, which writes the project pointer as a model write; save a copy to a different local path and open it; open a model that has no project.
- **Pass witness:** before the bind the Situation says "no project home" and the tiers fall back visibly. After it the Situation shows the project by its folder name and how it was found. The copy at a different path finds the same project, because the pointer travels with the bytes. The stored pointer holds no drive letter.
- **Cloud variant:** on the cloud throwaway clone, the pointer is written, the person synchronizes, and a second user home resolves the same project. This is assumption C of the MAP.
- **Lane:** dev session, controlled.
- **Runnable today:** no (slices 2 and 6).

### H4. A tool overwrites a shared file and the net restores it

- **Goal:** "Pea changed the firm terminal drop by mistake; give me yesterday's back."
- **Setup:** `Settings/ducts.json` in the firm home with terminal drop 0.03.
- **Steps:** Pea or a person writes 0.05 at the firm tier, with a notice and no guard; the driver reads the receipt for the prior hash and copies that blob back by hand; in the race variant, A and B write within one sync window.
- **Pass witness:** the hash after the restore equals the hash before. /fans reads 0.03 labelled firm again. The notice names the file, the writer and the receipt. In the race variant the compare-and-swap refuses the second write, and neither write is silently lost.
- **Lane:** two hosts for Pe's own net. The G: scratch folder for Drive's revisions. A restore from the second machine is UNPROVEN until the Drive spike runs.
- **Runnable today:** no. There is no firm write door and no net.

### H5. An update meets files it cannot read

- **Goal:** "I updated Pea and nothing of mine disappeared without telling me."
- **Setup:** install build N, seed the real old shapes, then install build N+1.
- **Steps:** start the host; open the standards list, /pods, /fans and /ducts on the Place that owned the Work; restart twice.
- **Pass witness:** each authored file is byte-identical and listed "can't read" with a reason, kept. Each Work file is gone, with one notice per file that names the Place and the staged values lost, and no repeat on the second restart. The host throws 0 times at start. The machine state root is the same path before and after.
- **Lane:** Sandbox with two installers. The dev session can seed the files but cannot falsify "update".
- **Runnable today:** no (slice 4, and a per-wave installer).

### H7a. Guard: overwrite or discard a person's model state

- **Steps:** ask Pea to save the open detached clone; leave it held, then press Save in Revit; ask Pea to stop the session with unsaved changes; ask Pea to save-as to a new path; have a script save a family document.
- **Pass witness:** Pea's save returns "held" at once and the file hash is unchanged. The guard renders once, in one place. The person's own Save goes through and its receipt names the person. The stop with unsaved changes is held. Save-as to a new path and the family save are not held. The driver records what happens when Pea reaches `Document.Save` through a script and when it copies the file with the shell; the written promise says which acts are only notices.
- **Lane:** dev session, controlled.
- **Fixture:** the detached Chadds clone.
- **Runnable today:** no guard exists; the consent window fires instead.

### H7b. Guard: synchronize with central

- **Steps:** ask Pea to synchronize; leave it held; the person synchronizes.
- **Pass witness:** while held, the central's hash or modified time is unchanged. After the person's own synchronize it changes. The guard renders once.
- **Lane:** dev session, controlled.
- **Fixture:** the local central made from the detached clone, and the cloud throwaway clone for the cloud case.
- **Runnable today:** no.

### H7c. Send outward: a notice, no guard (ADR 0052)

- **Steps:** have Pea read a copy of one Chadds cut sheet with the hosted parser; read the same pages again.
- **Pass witness:** the stand-in server receives 1 request at once, nothing is held, and the notice feed shows one row naming the file and LlamaCloud. The second read finds the kept result and sends nothing. The local parser path sends nothing. The driver records a shell `curl` upload honestly.
- **Lane:** dev session plus the stand-in server.
- **Runnable today:** no stand-in server lane exists; the deterministic witness is `ts/packages/mcps/tests/read-document.test.ts`.

### FS. A Fans value across tiers

- **Goal:** a value set at firm, overridden for the project and saved in the model shows a second person which tier won.
- **Setup:** two user homes, one firm home, the project home bound to the detached clone. The fan join fix and the tab-close fix have been driven first.
- **Steps:**
  1. A sets terminal drop 0.03 to 0.05 at the firm tier on /fans. It writes `Settings/ducts.json` in the firm home with a notice.
  2. A overrides the supply velocity limit 900 to 800 at the project tier.
  3. A stages the ESP for MUAS-1, plans and writes once. A second plan of consumed Work must refuse.
  4. B opens a copy of the post-write model and opens MUAS-1 on /fans.
  5. B reads the sheet.
  6. B changes the project value to 850.
  7. The firm home is unmounted.
- **Pass witness:** at step 5, terminal drop reads 0.05 as firm with the home name, A and the time; the supply limit reads 800 as project with "firm 900" shown as overridden; the ESP reads as saved in the model with A and the receipt; the auto-join gap reads as default. B's view opens on B's own state. At step 6, A sees 850 on refresh and the prior bytes are recoverable. At step 7, firm-sourced values say the firm home was not found and never say "firm". A census of which home served each value, from a host read, equals the sheet's labels. Guards render 0 times.
- **Lane:** two hosts; dev session for step 3.
- **Fixture:** the detached Chadds clone.
- **Runnable today:** step 3 only, and it has never passed (kernel journey F2).

## End-gate targets

Every target is read at one named SHA. Anything not run is stamped UNPROVEN with its lane, never counted as a pass.

1. Every journey above is green on its named lane.
2. Silent shadow copies: 0. A census across homes finds no id served from one home while another home holds the same id without a notice.
3. `$schema` values that name a scheme or host, in any authored file in any home: 0.
4. Files in the firm and project homes that are neither authored nor content-addressed: 0.
5. Shared derived files whose name does not match their bytes: 0.
6. Restores: the hash after a restore equals the hash before, for 100% of the shared writes in the drive.
7. Failure policy: N seeded unreadable authored files give N listed and kept, bytes unchanged; M stale Work files give exactly M notices that name the lost values; host start throws 0 times.
8. Provenance, as its own target: on every FS value, the sheet's tier label equals the home the host served, 100%.
9. Guards: exactly 1 rendering per guarded act and 0 elsewhere; a held act leaves the hash unchanged; each bypass is recorded.
10. Secret leak: a search for the firm key and its prefix across homes and logs finds 0 hits.
11. The host starts with the firm home unreachable, and the notice names where it looked.
12. J1: presses 0, `permission_request` 0, refused tool rows 0, consent waits 0, on both key sources. The rubric score, the confident-wrong count and the wall time are measured over three runs. The wall-time bound is set from the first measured run, not by ear. The owner has not set a bar for the score or the confident-wrong count.
13. J2: documents parsed again 0, drive scans repeated 0, vendor files fetched again 0.

Not targets for this crusade: scroll-track counts, panel signature counts, the standards file count (the target is "every file classed"), dev-lane host boot time.

The coworker bar is soft. kaitpw: "the bar for install on a coworkers computer, and everything working as expected, can be soft-ish. Theres just a certain level of uncertainty that we cant test unless we make a real release and have someone install it and test everything there."

## What a drive cannot observe

Each of these names the lane that can observe it, or stays UNPROVEN: Drive for Desktop sync on a local folder (G: scratch); a second licence or a second person (second profile, coworker machine); an installed upgrade (Sandbox); a native shell action, which leaves no receipt (recorded by hand); network egress (the stand-in server); whether a notice felt clear (the owner).

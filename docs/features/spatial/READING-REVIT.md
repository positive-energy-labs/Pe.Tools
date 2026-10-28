# Reading Revit: cost and truth

This doc is the authority for every Pe.* read of Revit geometry: Space, Ducts context, Pea's spatial verbs, Takeoff and clash detection. The decision is [ADR 0025](../../adr/0025-accurate-geometry-first.md). Open work lives in the [spatial ledger](LEDGER.md). Source: `.artifacts/accept/revit-read-lessons-20261027/MINED.md`. The R, U and M ids below point into it. Written 2026-10-27.

**Scope.** The original census is the cloud Chadds clone, Revit 2025, with one loaded IFC-derived RVT link. Later rows identify Manuella and Cleremont local copies explicitly; U16 records their different link and cost behaviour. The levels read uses the certified Chadds clone copy named in [MAP.md](MAP.md), not the older linkless standalone. Measurements remain scoped to their named model, source state, lane and version. The older `MEP_YoramLePairArchitects_ChaddsFord_R25_standalone_20261019.rvt` is a different, linkless model.

## Truth rules (kaitpw)

1. Accurate geometry is the top requirement, above memory. "accurate geometry is the biggest requirement by far. I assumed that was implicit" (cfdbb202, 2026-10-27 17:14Z). If a gate omits accuracy, it selects an inaccurate answer.
2. Never draw an element at an angle as an axis-aligned box. "any and every diagonal element needs to not just be simplified to a box, that is like the biggest form of our ui lying" (same message). On 2,942 rotated Chadds instances, the world box is a median 2.17 times the family-local box volume (P2).
3. Orient each element by its own frame, never by its link or document. Chadds has an axis-aligned wing and a wing at 45 degrees.
4. Partial rendering is harmful. "if we only render some stuff, thats actually harmful. this is not a case where best effort is ok" (6e8d2a25, 2026-10-25 04:41Z).
5. Meshes are first-class. "full data meshes are something i still need for my future dreams of running and visualizing clash detection on the same substrate" (cfdbb202, 2026-10-27 17:14Z).
6. Context includes other MEP. "we absolutely should not exclude other MEP from the proximity or context. if anything these are actually the most important types of context" (cfdbb202, 2026-10-27 06:19Z).

## Cost model as measured

All values are deltas of Revit private bytes in MiB. Unless a row says otherwise, the lane is session dev, SDK-controlled `pe.app-25`, Chadds, 2026-10-27. Cold means the first read in a fresh process. Evidence: `.artifacts/accept/space-focus-mesh-20261027/REPORT.md` (S2, S3, P2, P3) and `.artifacts/accept/space-memory-night-20261027/REPORT.md` (night).

| Work | Measured | Per element | Stamp |
|---|---|---:|---|
| First touch, IFC link (collector iteration, no bounding box) | 84,585 el, +1,125, 13.4 s | ≈13.6 KB | PROVEN[session dev, PID 52708, `41508321`, 12:33 CDT] |
| Same, other process | 71,731 el, +698.8, 10.7 s | ≈10 KB | PROVEN[session dev, PID 32756, `fbf76dbe`, ≈12:55 CDT] |
| First touch, host | 53,473 el, +39.1 | ≈0.7 KB | PID 52708 |
| Host `get_BoundingBox` | 34,123 el, +112.7 | ≈3.4 KB | PID 52708 |
| Link `get_BoundingBox` after first touch | 84,573 el, +48.2 | ≈0.6 KB | PID 52708 |
| Focus meshes, SA 7, cold | 283 meshes of 501 focus elements, 56,592 tri, +68 | | PROVEN[session dev, PID 72212, `2c6c1565`, 12:59 CDT] (P4) |
| Focus meshes, whole building, host MEP | 5,224 meshes + 4,082 runs, 1.1 M tri, +191 private (≈105 native), 7.4 s | ≈0.1 to 0.2 KB per tri | PROVEN[session dev, PID 51772, `41508321`, 12:13 CDT] |
| Near-field Medium context meshes, 10 ft around SA 7, cold | 29,107 el (17,266 IFC Structural Framing, 1,717 Generic Models with 637k tri), 2.2 M tri, +2,395 total, ≈430 s | ≈0.5 to 0.7 KB per tri (estimate) | PROVEN[session dev, PID 72212, `2c6c1565`, 12:59 to 13:22 CDT] (P4) |
| Product `/ducts` read on main, SA 7 cold, boxes (context layer on) | 13,111 host and 43,337 link candidates in the crop, 89% noise; link part 17.1 s and +630 MiB | context call 20.1 s, +822 MiB; warm repeat 3.2 s | PROVEN[session dev, probe-25, `674bac7d`+timing, 2026-10-27] |
| Product `/ducts` read on main, SA 7 cold, meshes | 30,778 candidates, 1.74 M tri at Coarse | 54.5 s, +2,443 MiB | PROVEN[session dev, probe-25, `674bac7d`+timing, 2026-10-27]. The ≈430 s row above is a probe script (Medium, Fine retries, 81,968 elements), not the product path |
| Product `/ducts` read, step 2 scoped reach, cold, boxes | Chadds SA 7: 49,061 ids in reach, 35,885 drawn (main 60,564 / 46,083); Cleremont SA 2: 5,431 / 1,235 (27,768 / 15,026) | SA 7 4.72 s +488 MiB (main 6.40 s +759); SA 2 0.35 s +30 (2.41 s +104) | PROVEN[session dev, harness `probe-r`, `5a9f6d58`, 2026-10-28]; `.artifacts/accept/space-proof/5a9f6d58-20261028T061655Z` and `…/5a9f6d58-20261028T062803Z` |
| Near-field repeats, same scope | ≈0 MiB, ≈405 s each | | P4: Medium context has no cache, so `Triangulate` runs again |
| Near-field, 10 ft around EX 7, after SA 7 | 7,803 el, 740k tri, +540 | ≈67 KB | P4 |
| Route (a) symbol bounds, no `Triangulate` | 200 rotated fittings, +16.1 | ≈82 KB | P2, PID 32756 |
| Medium mesh | 200 rotated fittings, +21.0 | ≈107 KB | P2, PID 32756 |
| Coarse context, whole building after five reads | +5,971 against boxes +1,068 | ≈40 KB | PROVEN[session dev, scripts, `660a3888`, night] for the deltas. The per-element value is arithmetic (R2) |
| Repeat of the same read, same process | ≈0 | | S2, S3 |
| PSC1 publish | +38 to +364 of managed heap commit, −465 after GC | | S2: transient .NET heap |
| Revit alone, native default 3D at Medium | 3.10 GB after open, 15.48 GB after the 3D view opens, 20.10 GB after 31.7 s API rotation, 17.78 GB idle later | | PROVEN[session dev, PID 76216, `660a3888`, 07:22Z]. Script compile raised the baseline to 3.63 GB first. API refresh is a proxy for mouse orbit. The command dirtied the model |
| `Levels.Read`, Manuella local copy, first read in a fresh process | 15 levels, 12 planes, 3 coincident groups; 76.22 ms, net private +4 KiB (below the memory noise floor) | All 3 links disclosed unloaded; authored scope retained; 311 horizontal ducts agree with reference-level `ProjectElevation` + offset, max error 9.88e−9 ft | PROVEN[session dev controlled, `probe-l` PID 65732 generation `20261028053241664`, `047921a0`, 2026-10-28 05:34Z]. No document modification; local file hash unchanged. Evidence: `t3-a8641718/.artifacts/accept/levels-20261028/gate-3/manuella-levels.json`. Browser alignment PROVEN[browser headless over session dev controlled, `probe-l` PID 65552 generation `20261028095218243`, `8eee5175`, 2026-10-28 09:51–09:57Z]: /ducts draws these datums at native height, see the ledger |
| `Levels.Read`, Cleremont local copy, first read in a fresh process | 50 levels across 7 placed sources, **32 planes, 11 coincident groups**; 96.20 ms, net private +124 KiB | All sources loaded, no authored level scopes; 319 horizontal ducts agree with reference-level `ProjectElevation` + offset, max error 1.30e−9 ft; independent datum-plane max error 3.30e−10 ft | PROVEN[session dev controlled, `probe-l` PID 58456 generation `20261028053501593`, `047921a0`, 2026-10-28 05:39Z]. No document modification; local file hash unchanged. Evidence: `t3-a8641718/.artifacts/accept/levels-20261028/gate-3/cleremont-levels-proof.json`. Browser alignment PROVEN[browser headless over session dev controlled, `probe-l` PID 65552 generation `20261028095218243`, `8eee5175`, 2026-10-28 09:51–09:57Z]: /ducts draws these datums at native height, see the ledger |
| `Levels.Read`, certified Chadds clone local copy, first read in a fresh process | 11 levels, 10 planes, 1 coincident group; 192.16 ms, zero net private-byte delta | Host 8 levels plus loaded IFC instance 9465481's 3; 3 other sources disclosed unloaded; stray `PE-CLOSE-PROBE-190704` retained; 2,414 horizontal ducts agree with reference-level `ProjectElevation` + offset, max error 9.31e−8 ft | PROVEN[session dev controlled, `probe-l` PID 6296 generation `20261028060750034`, `f92a7a15`, 2026-10-28 06:10Z]. No document modification; local file hash unchanged; 8 scene artifacts retain the native levels exactly. Evidence: `t3-a8641718/.artifacts/accept/levels-20261028/gate-4/chadds-levels.json`. Browser alignment PROVEN[browser headless over session dev controlled, `probe-l` PID 65552 generation `20261028095218243`, `8eee5175`, 2026-10-28 09:51–09:57Z]: /ducts draws these datums at native height, see the ledger |

What the table supports:
- Cost follows the elements walked. The loaded IFC link is the cost: first touch of its elements is ≈1.12 GiB of a ≈1.88 GiB cold whole-building read, before any geometry call. Radius, triangle budget and detail level do not bound it. On 2026-10-26, cold 10 ft context took 84.25 s and 15 ft took 86.67 s.
- Focus meshes are cheap on Chadds: +68 MiB cold for SA 7 and ≈105 MiB native at whole-building scale. Focus is mostly duct runs, which draw without a mesh, plus modest fittings.
- Near-field context meshes are not cheap on Chadds. The 10 ft reach around SA 7 pulls in 29,107 elements, which is 39 times the focus triangle count. It costs +2,395 MiB cold and ≈7 minutes on every read, repeats included. P4 did not separate expansion from tessellation. From S3, expansion is at most ≈1.2 GiB, so tessellation of the near field is at least ≈1.1 GiB. The probe used an axis-aligned 10 ft rule and coarse quick filters, which materialized 81,968 candidates. That is a superset of the product's triangle-distance proximity.
- A quick filter is free only while you count. `BoundingBoxIntersectsFilter` on the IFC link with `ToElementIds()` returned 43,345 ids for +0.7 MiB cold; iterating the same collector cost +607.5 MiB (≈14 KB per element). Every element the read iterates is paid for, so exclusions and reach must be quick filters applied before iteration. Halo/proximity on main saves almost nothing, because it tests after the candidates are loaded. The 45° link turns the host crop into a link-frame box of 2.04× the plan area. PROVEN[session dev, probe-25, `674bac7d`+timing, 2026-10-27]; report `.artifacts/accept/ducts-read-baseline-20261027/REPORT.md`.
- A repeat costs no memory. It still costs time when no cache holds the triangles.
- The reach query costs CPU, not memory, and scales with outlines × elements tested: 501 per-member outlines over Chadds' host took 19.5 s, and 13 reach-ANDed queries per source took Cleremont SA 19 to 6.2 s. Merged outlines behind one extent filter take 30–290 ms per source. The merge widened SA 7's IFC reach from 25,155 to ≈32,700 ids (≈+80 MiB) for 28 s → 4.7 s. PROVEN[session dev, harness `probe-r`, `55672b98`/`abf361cc`/`5a9f6d58`, 2026-10-28].
- After reach and exclusions, cold time is loading what really is near: SA 7 loads 32,401 IFC elements in 2.4 s. Exclusion counting over the reach ids costs 0.2–0.8 s on Chadds (13 id-seeded queries), the main cause of the accepted warm-read regression.
- A `FilteredElementCollector` seeded from an id collection refuses iteration without a filter ("The collector does not have a filter applied"); `Partition.Reach` adds `WhereElementIsNotElementType`.
- An exact oriented box from symbol `GetBoundingBox` costs ≈82 KB per element, against ≈107 KB for the Medium mesh. Geometry generation is the cost, not `Triangulate`. So the exact box is a fidelity tool, not a memory lever.

**UNRESOLVED: cost per triangle.** Host MEP focus costs ≈0.1 to 0.2 KB per triangle. Near-field context, dominated by IFC-link Structural Framing and Generic Models, costs ≈0.5 to 0.7 KB per triangle. That is about 4 times more, and the second value is an estimate after the expansion share is subtracted. P2 fittings gave ≈0.6 KB per triangle. Per element, the measures range from ≈40 KB (night Coarse, near-field SA 7) to ≈67 KB (EX 7) to ≈107 KB (P2). Hypothesis: MEP fittings share family-symbol geometry, so its generation amortizes across instances (S2 focus holds 2,599 elbows), but IFC-derived elements carry unique heavy geometry. UNPROVEN. The P2 fittings at ≈0.6 KB per triangle do not fit this hypothesis cleanly. Detail level and private against native accounting are also not excluded. The instrument is census items M4 and M5, which measure the per-category slope at three scopes. Until they run, no design may assume a per-element or per-triangle mesh cost.

## What passes as geometry but is not

Unless stated: PROVEN[session dev, SDK-controlled `pe.app-25` PID 19948, Chadds, `d3e739f9`, 2026-10-27 12:23 CDT, read-only census]. `Ingest.Allowed` (`dotnet/Pe.Revit.Space/Ingest.cs:44`) checks only `CategoryType.Model` and a deny list, so the first three items reach context today.

- **MEP centre-line helper elements.** Categories `OST_DuctCurvesCenterLine`, `OST_DuctFittingCenterLine`, `OST_PipeCurvesCenterLine`, `OST_PipeFittingCenterLine` and `OST_FlexDuctCurvesCenterLine`. Class `Element`, no type, no `Location`, 15,193 in the document. Revit uses them to draw the "Center line" subcategory. Exclude them. UNPROVEN that they map 1:1 to ducts and fittings.
- **CAD links.** `ImportInstance` with `IsLinked = true`: 15 are model-level, and 6 reached EX 7 context (two site plans, attic and roof DWGs, two `.3dm`). The mechanical 3D view hides them, but the scene ignores view visibility. Eight more are view-specific drafting DWGs. The boxes path does not check `ViewSpecific`. That is a code-path observation; UNPROVEN that one enters on Chadds. Ruling: CAD is an opt-in toggle in the 3D viewer and leaves Ducts context.
- **Insulation elements.** Chadds has 4,298 duct and 3,267 pipe insulations. Host thickness matches all 4,294 available duct parameters and all 3,267 pipe parameters; four duct hosts lack the parameter. This proves parameter parity, not geometric containment. Runs can carry their insulation in the sized representation. Fitting/accessory insulation keeps its own native mesh: see [fitting insulation](#fitting-insulation). Earlier axis-aligned insulation boxes enclosed all 74 EX 7 focus runs and fed the grey active-system bug (testimony, look-rule thread, `.artifacts/tmp/greyprobe`).
- **Levels** are `CategoryType.Annotation`: 8 of 8 host Levels. They never enter context. The "level planes" seen in context were the attic and roof DWG links.
- **Stray level `PE-CLOSE-PROBE-190704`** is at 1,352.0 ft elevation (1,004.0 ft project elevation). A past probe probably left it. Origin UNPROVEN. The MAP step 4 ruling retains it in the level read and root inventory. Distance from the pictured systems does not authorize hiding or deleting a datum.

**Exclusion classes, counted per model in reach (cold context, step 2, `5a9f6d58`).** Chadds host SA 7: centre-line 4,405, view-specific 3,518, sketch 3,061, insulation 2,443, non-geometry 84, CAD 8; Chadds IFC link: non-geometry 3 of 32,404. Cleremont 4-bed link SA 19: sketch 4,594, view-specific 4,114, planting 367, curtain-grid 146, non-geometry 93, separation 33, beam-system 8; host: centre-line 404, insulation 143, view-specific 122, sketch 86; site link: site 6, CAD 4. Manuella SA 42 host: view-specific 285, centre-line 283, sketch 198, insulation 10, CAD 4. No building class was excluded (witness: 0 near-run building elements lost). Unloaded placements are disclosed, not read: Manuella 3, Chadds 3.

## Method rules

1. **Run the control first.** Before you attribute cost to our code, remove our code and measure (M1). The control was possible on 2026-10-21 and ran on 2026-10-27 (R1).
2. **Put every top requirement in the gate.** A gate on repeat memory alone selected axis-aligned boxes (R3).
3. **A falsified premise reopens the decision before more code,** also when the user ordered the work. Name the departure at the site (R4).
4. **Read the ledger before you design** (M16). It already held the IFC link's 92% of tessellation time, 644 MiB per resident world, and the capsule over-report (R2, R4, R3).
5. **Screenshots, counts, API timings and stand-ins are testimony.** A stamp names the missing input: links, walls, the 45 degree wing, meshes (R8, R9).
6. **Cost follows the elements walked.** Measure per element and per category before you choose a lever (R11, U1).
7. **A silent bound is a defect.** The triangle budget limited export, not extraction, and hid elements for six days (R6). A bound states what it removes.
8. **Time the probe, and take the baseline after compile.** A memory counter in the loop took 112.79 s where the read took 0.76 s. Script compile added ≈0.5 GB (R7).
9. **Keep the proof lane quiet.** Check the `pea` shim target and the host URL. The `4f3b0d24` catalog deadlock is fixed; no catalog warm-up is needed. Close Ducts tabs that read automatically before a control. Do not use Computer Use.
10. **Keep one canonical statement per lever.** When a finding supersedes a ledger line, rebuild the line. Never leave PROVEN and FALSIFIED lines on the same lever.

## Open doubts (UNPROVEN, and code or decisions lean on them)

- **U1, cost per triangle** (above). Near-field meshes, the near-field radius, and any mesh level of detail depend on it.
- **U2, oriented boxes without tessellation.** Route (a) is exact on 800 Chadds instances, but it still pays ≈82 KB per element, so it is a fidelity tool only. `LocationCurve` covers all host MEP runs but none of the 71,688 IFC framing members, which have no `Location`. UNPROVEN on nested or multi-instance families and on direct solids.
- **U3, first touch.** A full IFC link walk costs ≈13 KB per element (+1,090 MiB, and +1,217 MiB via `GetElement` plus bounding box). PROVEN that `ToElementIds()` on a quick-filtered collector does not expand elements: +0.0 MiB over 91,829 link elements (session dev, probe-25, `b528483c`, 2026-10-27). So a freshness check by id set is free, and the memory win of a bounds cache depends on never touching the elements. Random samples under-read a full walk ≈30× (1,000 random: 0.4 KB per element; 5,000 consecutive: 9.7; all: 13.9), cause UNPROVEN. Measure by walking, never by random `GetElement`. Report: `.artifacts/accept/census-and-verbs-20261027/REPORT.md`.
- **U7, control against the user's footprint.** The control proves that Revit's 3D display alone reaches 15 to 20 GB on Chadds. UNPROVEN that the user's 10 to 12 GB came from it, because no record shows that a 3D view was open.
- **U5, Pea's spatial verbs.** MEASURED, not settled. Every verb's document entry calls `SpaceWorld.Prepare`, which tessellates the host and every loaded link; the verb's scope never reaches it. On Chadds one cold Sweep took 220 s and +9.4 GiB (Revit 3.7→13.8 GB); the IFC link was 169 s and +7.7 GiB of that, at ≈1.2 KB per link triangle against ≈0.1 for host MEP. The query itself took 1–64 ms. A host-only world cannot answer Probe (no floor or ceiling) or Partition (refuses: link absent or dirty), because Chadds structure lives in the IFC link (session dev, probe-25, `d6cae510`, 2026-10-27).
- **U6, `LinkedGeometryStore`.** No proof exists for cloud links, reload, unload or workset changes. `Prune` is untested. FALSIFIED that it survives a restart: the store path carries the session openId (host) and a random per-process id (link, `SpaceWorld.cs:47`, `LinkedGeometryStore.cs:36`), so a new process always misses, and each Prepare writes ≈550 MB into a cache shared with every session and pruned to 1 GiB.
- **U15, IFC Solid against Mesh.** The census sampled 4,138 of 4,143 solids with volume, but elements 1422648 and 1341401 tessellate to Mesh only.
- **The 2026-10-21 "saved Chadds copy without links".** The record does not name the file. UNPROVEN that it was `.artifacts/revit/detached/MEP_YoramLePairArchitects_ChaddsFord_R25_standalone_20261019.rvt`, the only other detached Chadds file. That file has no IFC link, no loaded links and 4,266 pipe insulations (PROVEN[session dev, controlled probe-o, 2026-10-28, step 3 census]), so it fits the description, but it is a different model from every Chadds number in this doc, which was measured on the cloud `Chadds_Clone_Aug_11`. The gate's Chadds copy is `MEP_Chadds_Clone_Aug_11_R25_local_20261028.rvt`, census-equal to that clone.
- **U16.** Chadds is the only model measured. Second model, 2026-10-28 (Manuella, local copy `.artifacts/revit/detached/MEP_BIG_Manuella_R25_V2_local_20261027.rvt`): all three Revit links unloaded and 7 host walls, so no loaded source holds building geometry; a cold /ducts read is ≈0.5 s and +4–6 MiB. Holds: a 45° wing (now in the host, world box median 2.18× oriented), counting ids is free in memory (but not in time: id queries took 9–71 s), centre-line helpers dominate noise (≈45% of context; 1:1 with pipes, not ducts), insulation from `RBS_REFERENCE_INSULATION_THICKNESS` (136/136 duct). New: view-specific DWGs enter context; 30% of family instances are tilted, so oriented boxes need the full 3D frame; levels repeat at one elevation under two naming sets. Untestable there: the per-element cost of a loaded link. PROVEN[session dev, probe-25, `bd9dd0d4`]; report `.artifacts/accept/manuella-generality-20261027/REPORT.md`. Third model, 2026-10-28 (Cleremont, local copy `.artifacts/revit/detached/MEP_Brodie_Cleremont_Ross_R25_local_20261028.rvt`): four loaded RVT links (site plus three house types) placed six times at different angles, one placement unshared about 2,100 ft away. A loaded RVT link walks at 0.8–2.3 KB per element (≈14 KB is an IFC-link property); Revit pays at open (7.1–7.4 GB). Cold /ducts context 1.6–3.6 s and +57–166 MiB. Breaks: one frame per link document (frames, partitions and oriented boxes belong to the link instance); `Level.Elevation` is relative to the project base point (use `ProjectElevation` through the instance transform; levels are per building); a system's crop can be a 1,500 ft cube because of far members (per-element reach is mandatory: −82%); sketch-based floors, roofs, ceilings and stairs have no cheap frame; links bring new noise (`<Sketch>`, curtain grids, room separations, origin markers, planting, topography, masses, nested DWGs); link availability depends on Desktop Connector sync. PROVEN[session dev, probe-25, `940f2c8f`]; report `.artifacts/accept/cleremont-generality-20261028/REPORT.md`.
- **U17.** FALSIFIED[session dev controlled, `probe-l` PID 58456, `047921a0`, 2026-10-28 05:39Z]: Cleremont's earlier 31-elevation / 12-coincident-group census was rounded. Exact native datums yield **32 planes / 11 groups**: host `A Level 2` (7715138) is 774.0000000000003 ft; linked `T.O.PLATE COTTAGE` (2347458, instance 7906706) is 774.0006569639478 ft. Their 0.000656963947449 ft gap is 0.20024 mm. Preserve both planes; do not tune grouping or drawing to reproduce the rounded count (orchestrator verdict, 2026-10-28 05:41Z). Same evidence as the Cleremont levels row above.

## U6 measured: cache attribution and revision identity (2026-10-28)

PROVEN[session dev, controlled `probe-c`, `3694edfc`, 2026-10-28 09:11–09:38Z].
Two fresh processes each on the Chadds clone SA 7 and Cleremont SA 19, using the harness's
pinned focus ids. Each context followed its focus read. Time is native context time; memory
is that call's Revit private-byte delta. These are the frozen step-2 baseline, before
`6842220f`'s exclusion-time fix and step 3's representation change.

| Model | Cold s / MiB | Warm s / MiB | After restart s / MiB | Warm again s / MiB |
|---|---:|---:|---:|---:|
| Chadds SA 7 | 5.298 / 502.1 | 1.744 / 168.4 | 5.048 / 505.7 | 1.968 / 115.6 |
| Cleremont SA 19 | 0.693 / 32.3 | 0.480 / 19.4 | 0.734 / 36.4 | 0.493 / 16.1 |

Attribution used identical inputs in one warmed process: seed, available, bypass, bypass,
available. An exclusive file lease made only this process's packs unavailable; no shared pack
was deleted. Every pair had identical vertex and element hashes. Means below exclude the seed.
Boxes context does not read the pack; coarse Meshes context bypasses it too. The scene's
remaining pack consumer is focus. Thus the cold-to-warm context improvement is not proof of
pack value: Revit's own loaded elements and geometry survive the call.

| Read | Chadds pack / bypass s | Cleremont pack / bypass s |
|---|---:|---:|
| Scene, Boxes | 2.184 / 2.389 | 0.467 / 0.481 |
| Scene, Meshes | 21.663 / 23.806 | 1.256 / 1.199 |
| Bounded `Partition.BuildElements`, Medium | 1.869 / 12.854 | 0.103 / 0.604 |

The bounded Partition comparison uses the same scene membership and crop, not whole-model
`Prepare`. `BuildElements` has no remaining production caller: this is a bounded witness of the
same pack machinery used by `Build`, not a measured whole-verb regression. It proves a substantial
warm latency benefit (85.5% / 83.0%); deletion must not be reported as a speedup for beta verbs.
The actual Cleremont Sweep comparison follows below; Chadds and the other beta verbs remain
unmeasured. Scene timings vary enough that their small differences do not establish a dependable
cache benefit. Step 3 removes scene pack reads altogether.

The proposed key failed two independent tests:

- `Document.GetDocumentVersion` took 0.36–0.78 ms for 1,000 calls, but its GUID/save count stayed
  unchanged through committed nearby and unrelated geometry moves, a link move, and rollback.
  The link instance UniqueId also stayed unchanged while its placement moved one foot.
  Neither version nor instance identity alone identifies current geometry.
- Across restart, both hosts and every loaded link reported different version GUIDs with
  unchanged save counts. No pack path was reused. The two local host files' SHA-256 hashes
  were unchanged. FALSIFIED[session dev, `probe-c`, `3694edfc`, 2026-10-28]: the loaded
  document version is a dependable cross-process key on these copies.

The mark-only `DocumentChanged` probe copied ids without loading elements. Nearby and distant
moves marked the correct subject separately; the nearby scene bounds matched native bounds,
and the distant move left scoped vertices and membership identical. Transaction-group rollback
reported an empty id set on both models, so an id-only selective invalidation rule is insufficient.
These witnesses do not prove arbitrary dependency, reload, workset, or cloud invalidation.

The raw-event probe also exposed a production wiring gap: `DocumentCacheMaintenance.Wire`
filtered empty deltas before `SpaceWorld` or the bridge received them. The implementation now
admits empty deltas outside the rollback sandbox; an empty group rollback is still a change
to captured evidence. The native regression uses that same production filter and checks epoch
advancement after rollback. PROVEN[attached over session dev controlled, `probe-c` PID 51692, `cf3ebbe3`, 2026-10-28 13:26–13:30Z]: exact rollback geometry restored after a zero-id epoch
advance, 18/18 native Space regressions.

User ruling after the bounded Partition result: measure the actual Pea `revit.detail.space-sweep`
operation cold and repeatedly on Cleremont, before and after disabling the store. Its production
path is `SpaceOps.Sweep` → `Verbs.Sweep(Document, ...)` → `SpaceWorld.Prepare` → `Partition.Build`,
which did read the pack; the dead `BuildElements` entrypoint does not mean production gained
nothing. No resident geometry cache may be added in step 5. The later ruling below retains the
existing disk pack until step 6 re-measures its benefit after moving verbs onto the scoped read.
Any future resident reuse requires a measured hard memory cap. The production comparison follows
below; host-call elapsed time includes Prepare, while `SweepAnswer.Ms` times only the query.

All test transactions were rolled back, all document `IsModified` checks were false, four owned
Revit PIDs (36120, 72280, 7420, 49524) were confirmed gone, and the owned backend was stopped.
Raw receipts, templates, hashes and one-second process/kernel memory samples are in worktree
`t3-19486141`, `.artifacts/runs/session-20261028-space-cache/measure-20261028T091112Z/`;
`summary.json` is the compact index. No store implementation change is certified by this baseline.

### U6 follow-up: linked paths and external references

PROVEN[session dev, controlled `probe-c`, `fa8de88f`, 2026-10-28 10:12–10:21Z]. Two fresh
Cleremont processes (14444, 59420), inspecting identity immediately after open, before a scene
read. All six placements had the same nonempty `Document.PathName` across processes: four
files under Desktop Connector's `DC/ACCDocs/.../Cleremont - Ross Cabins/Links/`. Three placements
share the 3 BED file, so source-document identity and placement identity remain separate.

The linked documents are workshared, non-cloud documents. `GetWorksharingCentralModelPath`
returns a non-null model path whose user-visible string is empty; direct `GetCloudModelPath`
throws. Our `GetDocumentModelPath` returns that empty central path, and `GetDocumentPath`
then returns null without consulting the valid `PathName`. Thus `GetDocumentKey` wrongly
falls back to `project:unsaved:<title>:<hash>` for saved linked files. FALSIFIED[session dev,
`probe-c`, `fa8de88f`]: Cleremont's loaded link documents have no path. The path is present;
our helper discards it. The root fix is to fall back to `PathName` when the converted model
path is empty, preserving the existing `project:path:...` key format for every consumer.

`ExternalFileUtils.GetExternalFileReference` rejects every link type here. The types instead
provide external-resource references from server `baddc547-d952-4d29-ae01-16e71e75aa63`.
The complete reference-information maps (`CDX_FILE_ID`, `CDX_SDK_VER`, `CDX_TYPE`), resource
versions, instance UniqueIds and paths were identical across both processes. Native loaded
document versions changed for the host and all four source files; the host's version read by
`BasicFileInfo.GetDocumentVersion` stayed identical. Neither process modified the host or links;
the local host file's SHA-256 stayed unchanged. Both Revit PIDs and the owned backend were stopped.

The placed-source address is the host document key plus the resolved source-document key plus
the link instance id; the existing scene contract already carries all three. The root path
fix makes that address stable on the measured copies. External-resource version is available
as saved-resource provenance, but stability across reopen does not prove geometry invalidation:
instance placement and unsaved geometry can change without a version change. No loaded-version
or external-reference cache replaces the existing pack. Rename, external replacement, workset
changes and cross-machine Desktop Connector paths are not certified by this probe.

Evidence: worktree `t3-19486141`, `.artifacts/runs/session-20261028-space-cache/identity-20261028T101245Z/`
(`summary.json`, full native receipts, file hashes, process/kernel memory log). The production
Sweep below proves the new helper on these links in one process. The landing gate below adds the
dedicated workshared-link fixture and a second changed-code process.

### U6 production Sweep: the repeat regression is real

PROVEN[session dev, controlled `probe-c`, `3694edfc` / `9a58edb2`, 2026-10-28 11:35–11:46Z].
The actual Pea CLI called `revit.detail.space-sweep` on the Cleremont local copy, along duct
`7950034` (`647d65be-a078-4dc5-a0f7-c05037e2c349-00794ed2`), excluding that duct itself.
Each revision had a fresh process, then one cold call and two repeats of the identical request.
The candidate disables store generation, so `Partition.Build` reads native geometry each call.
Sweep, ingestion and BVH source code are unchanged between these revisions.

| Actual production Sweep | Pack, `3694edfc` | Store disabled, `9a58edb2` |
|---|---:|---:|
| Cold operation elapsed | 27.526 s | 24.471 s |
| Warm repeat 1 | 11.317 s | 15.772 s |
| Warm repeat 2 | 11.297 s | 15.581 s |
| Warm mean | 11.307 s | 15.677 s |
| Cold private-byte delta | +2,169.9 MiB | +1,798.3 MiB |
| Process private peak, 1 Hz sample | 9.01 GiB | 9.44 GiB |

The cross-call repeat regresses **38.6% (+4.37 s)**. This is smaller than the bounded ingest's
7× difference, but plainly exceeds variation between these repeats. It is not a speedup.
The query itself took 2–10 ms. The table uses the host operation's elapsed time, including
Prepare and transport; CLI startup is excluded. This is one production Sweep request on
Cleremont, not a measurement of every beta verb or Chadds' whole-model Prepare.

The candidate's warm private-byte deltas were +1,099.1 then −1,049.8 MiB, so these samples do
not show monotonic retained-memory growth, nor establish a memory win. Minimum machine free
was 15.25 GiB and neither watchdog fired. All six query answers agree exactly after excluding
timing, capture stamps and the deliberately repaired document-key strings. Native element and
link-instance identities, verdicts, gaps and searched counts agree. Every `IsModified` check
was false and the local model's SHA-256 was unchanged. PIDs 48984 and 15640 and both owned
backend trees were stopped; the implementation branch was restored and the slot released.

The candidate's production response also carries the corrected `project:path:...` key for
all six linked placements, with three placements sharing the same 3 BED source key. That is
runtime evidence of the path fallback in the real model; the landing gate below adds the second
changed-code process and the dedicated workshared-link fixture.

Revised ruling after the memory attribution was corrected: **keep the verb store and flags in
step 5**. The existing pack retains bytes on disk, not a resident World. Deletion has no proved
peak-memory win and loses 38.6% on a production repeat. Step 3 removes the scene path's store
use independently. Step 6 must first move the verbs onto the scoped read, then re-measure the
pack's benefit; deletion is permitted only when that benefit is gone. The comparison bar is
the 11.307 s Cleremont Sweep repeat. Step 5 adds no resident geometry cache; any future resident
reuse needs a hard memory cap and measurements. The whole-model Prepare/first-touch cost remains
the cause established for the 13.8 GiB observation, not the disk pack.
Evidence: worktree `t3-19486141`, `.artifacts/runs/session-20261028-space-cache/verb-ab-20261028T113513Z/`
(`results.json`, `summary.json`, exact request, raw CLI/SDK receipts and memory logs).

### U6 landing gate: step 5 fixes against unchanged main

Native regressions, PROVEN[attached over session dev controlled, `probe-c` PID 51692, `cf3ebbe3`, 2026-10-28 13:26–13:30Z]: 18/18 attached, including
`WorksharedLinkUsesItsResolvedPathAcrossPlacementsAndReopen` and the production-filter rollback epoch
test. Receipt: `native-20261028T132614Z/002-native-fixtures.json`.

Three-model gate, PROVEN[session dev controlled, `probe-c`, `cf3ebbe3`, 2026-10-28 13:30–13:47Z]: 28 reads on Chadds, Cleremont and Manuella.
All 7 pinned id sets and every census equal step 2; every document unmodified; every model file's
SHA-256 unchanged. Cleremont's six linked keys are now equal across processes. Output:
`.artifacts/accept/space-proof/cf3ebbe3-20261028T133050Z/`.

Same-hold timing control, PROVEN[session dev controlled, `probe-c`, `746599a9` vs `466a0089`,
2026-10-28 13:53–14:14Z]. One driver ran main and then the candidate in the same worktree. Each
system got a fresh Revit process (main 64996, 14752; candidate 69900, 25648). Both variants carried
the identical startup-only `pe-service.ts` receipt-rename overlay; no other product bytes differed
from the named revision. Native context time, Boxes context:

| Chadds | main s | candidate s | candidate on `cf3ebbe3`, gate hold s |
|---|---:|---:|---:|
| SA 7 context cold | 6.29 | 7.03 | 6.03 |
| SA 7 context warm | 1.91 | 2.13 | 2.12 |
| EX 7 context cold | 1.90 | 1.86 | 1.67 (same process as SA 7) |
| EX 7 context warm | 0.78 | 0.89 | 0.93 (same process as SA 7) |
| SA 7 / EX 7 focus cold | 0.77 / 0.55 | 0.83 / 0.57 | 0.75 / 0.41 |

Ruled within noise: one sample per cell, and no mechanism. Main's and the candidate's receipts
are equal in every non-timing field: epoch 0, `fresh`, identical broad, extracted and geometry-call
counts, identical document keys (the Chadds paths were never empty, so the fallback is a no-op there).
Only the managed-heap bytes differ. The SA 7 cold gap (+0.74 s) is 0.44 s of IFC link iteration,
which is Revit's native geometry walk. On identical candidate bytes that walk took 3.49 s in the gate hold
and 4.00 s here. Accuracy is identical: 66.5% / 70.0% of rotated elements drawn axis-aligned on
both, main's pre-existing box limit owned by step 3. The Chadds file hash was unchanged; all four PIDs
and both backends were gone; the driver restored the branch and released slot-1 at 14:14:23Z.
Evidence: worktree `t3-19486141`, `.artifacts/runs/session-20261028-space-cache/context-ab-20261028T135324Z/`
(`<variant>/results.md`, `results.json`, `system-top.jsonl`).
## Representation premises, 2026-10-28

The Chadds gate copy `MEP_Chadds_Clone_Aug_11_R25_local_20261028.rvt` was made through SDK `save-stripped`, with `sourceUnchanged: true`. A fresh process reopened it with IFC instance `9465481` loaded. All 196 per-partition/category counts match the cloud source. Link inventories and instance transforms match exactly. Both census reads left the documents unmodified. PROVEN[session dev, controlled `probe-o`, cloud PID 53588 / local PID 55572, `004c7b43`, 2026-10-28 03:53Z]. Evidence under worktree `t3-5b8bc59c/.artifacts/accept/oriented-20261028/ev/`: `chadds-save-local.json`, `cloud-census-counts.json`, `local-census-counts.json`, `clone-census-comparison.json`. These counts certify the agreed copy gate, not geometric equality of every element. `clone-levels.json` records local level IDs, names and `ProjectElevation`; cloud-versus-local level equality was not measured.

| Model | Pipe insulation host parameter versus Thickness | Duct insulation host parameter versus Thickness |
|---|---|---|
| Chadds clone copy | 3,267/3,267 exact, max error 0 ft | 4,294 exact, 4 missing host parameters out of 4,298; max measured error 0 ft |
| Chadds older standalone, a different model | 4,266/4,266 exact, max error 0 ft | 5,491 exact, 4 missing host parameters out of 5,495; max measured error 0 ft |
| Manuella local | None present | 136/136 exact |
| Cleremont local, including loaded links | None present | 364/364 exact |

PROVEN[session dev, controlled `probe-o`, clone PID 55572 / other copies PID 47116, `004c7b43` working tree, 2026-10-28]. Evidence: `clone-premises.json`, `chadds-premises.json`, `manuella-premises.json`, `cleremont-premises.json` in the same directory. Missing host parameters are not parity successes.

**The IFC frame premise is false.** The first 800 structural framing elements in the clone's IFC link are all `DirectShape`, with 800 distinct symbol geometry identities and 800 identity instance transforms. They have no usable location line. A symbol AABB times that identity frame remains a document-axis box and cannot establish each member's orientation. Meshes retain the exact element geometry; the later measured link-envelope exception is disclosed below. FALSIFIED[session dev, controlled `probe-o` PID 55572, IFC framing as FamilyInstance with an element frame, `004c7b43`, 03:54Z]. Evidence: `clone-ifc-frames.json`. A frame derived from each shape's triangles remains an unmeasured option, not a default.

Symbol reads below follow preceding census/insulation reads; they are **not cold product costs**. They include collector iteration, geometry and result construction. Native geometry was read at Medium, without triangulation. Native family frames matched `GetTotalTransform` in every sampled family; no sampled family had nested or multiple root instances. This sample does not prove those absent elsewhere.

| Model/source and route | Elements | Seconds | Private delta | Bytes/element |
|---|---:|---:|---:|---:|
| Chadds clone duct fittings, symbol bounds | 800 | 0.1621 | 6,131,712 | 7,665 |
| Chadds clone IFC DirectShape framing, symbol bounds | 800 | 0.2659 | 51,519,488 | 64,399 |
| Manuella duct fittings, symbol bounds | 459 | 0.1470 | 6,701,056 | 14,599 |
| Cleremont host duct fittings, symbol bounds | 585 | 0.2268 | 17,784,832 | 30,401 |
| Cleremont house framing, symbol bounds, three documents | 32 / 112 / 334 | 0.0151 / 0.0383 / 0.0783 | -4,096 / 0 / -4,096 | Allocation noise |

PROVEN[session dev, controlled `probe-o`, same evidence and custody as the insulation table]. UNPROVEN[cold oriented product cost; IFC mesh cost under step 2 per-element reach]. Geometry cache identity must use `GetSymbolGeometryId().AsUniqueIdentifier()` plus document and detail, not `FamilySymbol.Id`: 800 clone duct fittings produced 290 native geometry identities. Curved Chadds flex samples expose `LocationCurve` with `HermiteSpline`; a straight chord is not their path.

## Round run sizes

**Round run sizes, certified Chadds clone.** Connector diameter is nominal for pipe and conduit.
Of one straight instance per type/connector-size pair, 29/32 pipe samples and 4/4 conduit
samples differed from their physical diameter. Pipe 5780581 has a 4 in connector and 4.5 in
outside diameter; conduit 6183151 has a 3 in connector and 3.5 in outside diameter.
`RBS_PIPE_OUTER_DIAMETER` matched the largest analytic `CylindricalFace` diameter in all 32
pipe samples, maximum error 1e-16 ft. `RBS_CONDUIT_OUTER_DIAM_PARAM` matched all four conduit
samples, maximum error 1e-17 ft. Add twice the host insulation thickness to these outside sizes.
This is a type/size sample, not an all-instance proof. PROVEN[session dev, controlled `probe-o`
PID 42380, native payload `daf5e204` / `322517bcb358`, 2026-10-28 07:41–07:45Z].
Evidence: worktree `t3-5b8bc59c`, `.artifacts/accept/oriented-20261028/ev/clone-round-cylinders.json`.
FALSIFIED[the connector radius is the physical pipe/conduit radius]. The artifact witness
checks published sizes against outside parameters and straight-run analytic cylinders; it does
not use a chosen allowance for tessellation error.

## Fitting insulation

Cleremont's 364 duct insulations have 178 `Duct` hosts and 186 `FamilyInstance` hosts.
Every fitting-host insulation has native Fine vertices outside its host's Fine symbol box.
The maximum excess is 0.269365325060402 ft at host 9411068, insulation 9411448, whose
thickness is 0.125 ft. Eight exceed their thickness by more than 1%; the cause of those
larger excesses is not established. A box grown by thickness is therefore not a proven
replacement for fitting insulation. The document remained unmodified.
FALSIFIED[session dev, controlled `probe-o` PID 15568, fitting symbol boxes contain their
insulation, native `05686ec9` / build `e4ae1c82be20`, 2026-10-28 08:57–08:58Z].
Evidence in worktree `t3-5b8bc59c`: `.artifacts/accept/oriented-20261028/ev/cleremont-insulation-hosts.json`
and `cleremont-insulation-family-bounds.json`.

The chosen split retains fitting/accessory insulation as separate native geometry. Only a
represented duct/pipe run with matching host thickness can absorb its insulation. Missing
hosts, missing sizes, and the all-mesh request retain insulation geometry. Host classification
requires loading the insulation and its host, after the quick reach and noise filters; it
cannot be reported as a quick-filter exclusion. The full-read cost and Chadds host-class
counts are below; separate insulation cost and the three-model containment gate remain unproven.


## Representation cost under shipped reach, 2026-10-28

The `adc1c811` candidate includes step 2's landed reach/warm-read fix and step 4 levels.
The harness recorded these cold-labelled context reads. Only the first system in each
fresh process is process-cold; the later systems follow earlier reads in that process.
Memory is the harness's sampled private-byte delta across the operation, not the narrower
SceneWork start/end window.

| Model / system | Revit seconds | Private delta MiB | Published elements |
|---|---:|---:|---:|
| Chadds clone SA 7 | 61.181 | 5,179.0 | 37,296 |
| Chadds clone EX 7 | 11.064 | 896.7 | 8,469 |
| Cleremont SA 19 | 1.395 | 85.3 | 1,852 |
| Cleremont SA 2 | 0.872 | 8.7 | 1,187 |
| Cleremont SA 21 | 0.879 | 78.9 | 1,173 |

Chadds SA 7 published 2,384,895 triangles, including 29,745 DirectShape mesh rows.
SceneWork's narrower private-byte interval grew 5,327,753,216 bytes; managed live bytes
at its end were 603,434,568. This does not isolate native materialization from managed
heap commitment. That split, cold triangle-box costs and Coarse detail remain unproven.
Meshes cannot be the landed IFC default at this cost.
PROVEN[session dev, controlled `probe-o` PID 65256 Chadds / PID 77728 Cleremont,
`adc1c811`, 2026-10-28 10:55�11:35Z, harness timing/memory columns]. Root evidence:
`.artifacts/accept/space-proof/adc1c811-20261028T105454Z-oriented/results.json`.

The clone's insulation host census is 4,298 duct insulations: 2,266 family hosts,
2,008 duct hosts, 20 flex hosts and four missing hosts. Pipe insulation is 3,267:
1,598 family hosts and 1,669 pipe hosts. Pipe host thickness matches all 3,267 own
Thickness values exactly. Duct parity is 4,294/4,294 available hosts, maximum error zero.
The separate linkless standalone has 4,266/4,266 pipe parity and is not the gate model.
PROVEN[session dev, controlled `probe-o` PID 65256, `adc1c811`, 2026-10-28 11:01�11:07Z,
`ev/chadds/p0/022-post-artifact-primitives.cs-SA7.stdout` in the root evidence directory].

At runtime `VertexTolerance` was 0.0005233832795 ft. Chadds SA 7 maxima were 7.15034x
for the rejected inscribed facets, 0.0506742x for circumscribed facets and 0.0615391x for
folded insulation. Cleremont SA 19 reached 4.85944x, 0.121950x and 0.156292x respectively.
The latter two are contained at Revit's resolution but need residual diagnosis. The old
witness stopped on them; the clarified tiers record 0.1�1x and fail only above 1x.
Cause remains UNPROVEN. Saved rows identify host 7950034 / insulation 8903976,
7950297 / 8903984 and 7950371 / 8903986 among the middle-tier findings.

The IFC outlier was a witness pairing bug. Element `1254396` in IFC placement `9465481`
was paired with a near-collinear triangle elsewhere in the same element, producing
24.026413 ft deviation. Its correct native triangle contains the questioned published
vertices within 0.000034810 ft under a derived 0.000042994 ft bound. The link transform
matches the certified 45-degree placement. Native and published geometry coincide at
the scene crop; the saved three-view picture identifies the erroneous old pair.
PROVEN[session dev, controlled `probe-o` PID 13668, `cabe69e3`, 2026-10-28 12:26Z;
deterministic replay of saved native triangles, frozen interval predicate]. Evidence in
`t3-5b8bc59c/.artifacts/accept/oriented-20261028/browser/ifc-outlier-1254396-native-published.png`
and `outlier-interval.json`.

The corrected full Chadds SA 7 mesh witness passed with maximum deviation
0.000089090 ft, 0.170219 times native VertexTolerance, under its per-triangle derived
bound. It recorded 145 middle-tier residuals for diagnosis instead of aborting.
The full triangle-box witness also passed. Flex is native mesh: 27 elements and
31,068 reverse-checked native vertices. All documents stayed unmodified.
PROVEN[session dev, controlled `probe-o` PIDs 13668 / 54132, `cabe69e3`,
2026-10-28 12:09-13:16Z]. Root evidence directories are
`.artifacts/accept/space-proof/cabe69e3-20261028T120923Z-triangle-boxes` and
`.artifacts/accept/space-proof/cabe69e3-20261028T122729Z-oriented`.

| Chadds SA 7, first context read in fresh process | Native s | Private delta MiB | Artifact bytes | Published triangles |
|---|---:|---:|---:|---:|
| Meshes for IFC | 64.113 | 5,197.4 | 113,859,984 | 2,395,251 |
| Triangle boxes for IFC | 79.317 | 5,233.4 | 48,019,084 | 320,995 |
| Link-frame boxes for IFC | 8.457 | 667.2 | 47,985,488 | 321,081 |

Meshes and triangle boxes materialize full IFC geometry. Link-frame boxes avoid it.
Their 535,531,520-byte in-process private delta is narrower than the harness delta.
All costs exclude the later accuracy witness. SA 7's link-envelope witness passed:
maximum native vertex excursion 0.00000762694 ft, 0.014572 times VertexTolerance;
all represented runs, family boxes, flex and insulation also passed. Source `9465481`
has 29,734 link boxes; 22 DirectShapes retain native meshes, including degenerate
native bounding boxes. The redundant premise that all triangle-box elements have
positive native bounding-box extents was FALSIFIED after the gate, and retired.
PROVEN[session dev, controlled probe-o PID 45052, `440cdf85`, 2026-10-28 14:18-14:27Z].
Root evidence: `.artifacts/accept/space-proof/440cdf85-20261028T141432Z-link-boxes`.

The 29,733 common envelopes have volume-ratio median 0.99993, p90 1.07219,
p95 5.97021, p99 12.10914 and max 518.15895. 2,834 exceed 1.5x; 2,817 of those
also differ from the link frame by more than one degree. The worst is structural
framing element `1239883` in IFC placement `9465481`, 3,847.807 versus 7.426 cubic feet.
A source bounding box alone cannot distinguish internally rotated geometry from an
axis-aligned body with the same extents. No proven cheap classifier is implemented;
production reports the loose count as unmeasured, not zero. The measured tail identities
come from the earlier geometry read. Its separate materialization cost remains pending.
EX 7 cold cost, remaining model gates and final browser comparisons remain pending.

## Instrument

The "Revit read cost census" entrypoint in the [`document-profiler` Pod](../../../examples/pods/document-profiler/) is the instrument for census items M1 to M7, M14 and M18 (MINED §5). Another agent is building it (2026-10-27); this doc has not verified it. Run it on a second project before you use any number here outside Chadds.

### Step 3 EX 7 and Cleremont checkpoint, 2026-10-28

PROVEN[session dev controlled, probe-o PID 16412, `2c282583`, 2026-10-28 15:21-15:23Z]: Chadds EX 7 link boxes, fresh process, took 2.196188 s native and +85.3 MiB over the harness interval. The complete artifact is 12,398,544 bytes, 8,514 elements and 114,749 triangles; 6,183 elements use the disclosed link frame. All 7,175 boxes, 886 runs and 453 meshes passed. Maximum envelope excursion is 7.629234e-6 ft, 0.01458 times runtime VertexTolerance; maximum mesh deviation is 3.385487e-5 ft, 0.06468 times it. The document stayed unmodified. Evidence: `.artifacts/accept/space-proof/2c282583-20261028T151640Z-link-boxes` in the root checkout.

EX 7 is less tight than SA 7. Exact placed-identity comparison of 6,183 link/triangle boxes finds 1,294 above 1.5x volume (20.93%), median 0.99997, p90 4.6712, p95 15.2138, p99 222.1348 and max 643.1223. This is containing over-draw, not exact element orientation. SA 7's corresponding tail is 9.53%. Same-camera pictures for all three options on both systems are saved under `t3-5b8bc59c/.artifacts/accept/oriented-20261028/browser/comparison-*.png`; the browser lane is owned headless Chromium. Each screenshot has a camera/canvas receipt and archived rendered PSC1. EX 7's UI includes 153 focus elements against the fixed native gate's 108, so its screenshot is supporting testimony rather than a second full native accuracy claim.

FALSIFIED[session dev controlled, probe-o PID 49556, `2c282583`, 2026-10-28 15:36-15:38Z]: Cleremont completeness. SA 19/SA 2/SA 21 published representations all pass the native primitive witness, but their receipts report missing-geometry with 102/70/34 cuts in placements 7906706/7906691/7906668. Native context costs are 1.433/1.135/1.075 s and +65.6/+22.5/+79.2 MiB. No document mutation occurred. The incomplete receipts correctly prevented browser proof and landing.

Saved main uncropped geometry packs distinguish two causes. Checksum-verified records, tied to each placement by at least three matching published mesh unique ids and host bounds, contain zero triangles for 100/70/34 baseline-only elements. These are 135 Walls, 58 Reveals, 10 Rectangular Straight Wall Openings and one Roof. This does not prove raw Revit geometry was empty: native null/empty/throw state, class and solid presence remain UNPROVEN. Twelve other SA 19 baseline-only elements (one floor, six railings, five handrails) are wholly outside the crop after exact rational clipping of their saved native triangles. Evidence: `cleremont-pack-coverage.json`, `cleremont-native-zero-candidates.json` and `cleremont-missing-offline.json` in the same worktree acceptance directory. The receipts did not persist exact zero-row ids; the baseline-difference list must not be presented as a complete confirmed per-element failure log. The unrelated 64-297 rejectedAfterLoad elements fail Ingest.Allowed earlier; these 204 passed that gate.

The 204-id native truth DLL compiled and ran its selectors/classification/serialization offline on all three model artifacts and the exact request. SHA256: `95107c3d65ba721cddd6f5141ed3b486858beb43d6bc94bf9c6f2ecf281bbf2f`. Its native behavior remains UNPROVEN. Kaitpw paused the next hold before any model opened. SDK stopped pending PID 56412; all owned host, browser and wrapper processes were confirmed gone, slot 1 removed, and no requeue made at 16:01Z. Production source remains unchanged from the measured candidate.

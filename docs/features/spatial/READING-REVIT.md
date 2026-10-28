# Reading Revit: cost and truth

This doc is the authority for every Pe.* read of Revit geometry: Space, Ducts context, Pea's spatial verbs, Takeoff and clash detection. The decision is [ADR 0025](../../adr/0025-accurate-geometry-first.md). Open work lives in the [spatial ledger](LEDGER.md). Source: `.artifacts/accept/revit-read-lessons-20261027/MINED.md`. The R, U and M ids below point into it. Written 2026-10-27.

**Scope.** The original census is the cloud Chadds clone, Revit 2025, with one loaded IFC-derived RVT link. Later rows identify Manuella and Cleremont local copies explicitly; U16 records their different link and cost behaviour. The levels read uses the certified Chadds clone copy named in [MAP.md](MAP.md), not the older linkless standalone. Measurements remain scoped to their named model, source state, lane and version.

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
- **Insulation elements.** 4,298 duct and 3,267 pipe insulations. Draw insulation from the host plus `RBS_REFERENCE_INSULATION_THICKNESS`. On 4,294 of 4,294 hosted duct insulations, that value equals the insulation's own Thickness (PROVEN for the data, PID 51772). Pipe insulation is not checked: UNPROVEN. When insulation and equipment were drawn as their own context boxes, they enclosed all 74 EX 7 focus runs. That fed the grey active-system bug (testimony, look-rule thread, `.artifacts/tmp/greyprobe`).
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
advancement after rollback. UNPROVEN[changed filter's runtime behavior pending the native hold].

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
Sweep below proves the new helper on these links in one process; the final gate still owes a
second changed-code process and the dedicated identity fixture.

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
runtime evidence of the path fallback in the real model; the final gate still owes the second
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

## Instrument

The "Revit read cost census" entrypoint in the [`document-profiler` Pod](../../../examples/pods/document-profiler/) is the instrument for census items M1 to M7, M14 and M18 (MINED §5). Another agent is building it (2026-10-27); this doc has not verified it. Run it on a second project before you use any number here outside Chadds.

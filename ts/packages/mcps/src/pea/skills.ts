import path from "node:path";
import { browserSkillName, renderBrowserGuide } from "@pe/browser/guide";
import { userRoot } from "@pe/host-contracts/product-paths";
import { renderDuctsSkill } from "@pe/fans-contract/pea/ducts-skill";
import { renderSchedulesSkill } from "./schedules-skill.ts";
import { renderFamiliesSkill } from "./families-skill.ts";
import { renderFamilySkill } from "./family-skill.ts";

export interface BundledPeaSkill {
  name: string;
  content: string;
}

export const bundledPeaSkills: readonly BundledPeaSkill[] = [
  {
    name: browserSkillName,
    content: renderBrowserGuide("pea browser"),
  },
  {
    name: "make-page",
    content: String.raw`---
name: make-page
description: Use for a chart, table, diagram, comparison, calculation walk, or mechanism explanation published as a scratch Page with one pe_do Page call. It validates and publishes HTML and returns a visible PNG plus an open URL. No Revit model needed for illustrations. A Page that belongs to a Pod is a file in that Pod; build-pod owns it.
---

# Make a Page

This skill makes scratch Pages: drafts under Pages/<slug>/ that only the Page call writes. A scratch Page has no scripts you can name by key. A Page that runs a Pod's scripts, or that travels with a tool, is the file pages/<page>/index.html inside the Pod, written with file tools; skill:@product/skills/build-pod owns that. The Page code below (pe.js) is the same in both.

Bare paths and leading / resolve from the Pod root; ./ and ../ resolve beside the Page's index.html.
A Page no browser has rendered is reported as untested, with what was and was not checked.

Use pe_do({kind: "page", slug, title, html}) before the final reply when a visual would explain a mechanism, comparison, or calculation. Send a complete self-contained HTML document with inline style and script. The host checks it, captures it, and writes Pages/<slug>/index.html under its product home. Its result includes the canonical Page key, absolute openUrl, and a PNG shown in the conversation. Return its openUrl with a short takeaway; the person already sees the picture. Default to a compact single view for teaching: one diagram or comparison, short labels, and only controls that clarify an assumption. Aim for about 3 KB of HTML for the first visual. Every correction or update resubmits complete HTML through the same Page call with the same slug. Keep that HTML in the turn; never locate, read, or patch a scratch Page's files through a terminal or direct access to the content home. If the call refuses, fix the stated problem and resubmit the HTML.

Worked example, the Snowdon duct-loss shape (page:@snowdon-ducts/pages/tour): explain the pressure budget as straight duct plus fittings plus a VAV allowance. For a teaching illustration, publish it directly with assumed inputs rather than waiting for that example's model binding:

    pe_do({kind: "page", slug: "duct-pressure-lesson", title: "Duct pressure budget", html: '<!doctype html><html><head><title>Duct pressure budget</title><style>body{font:18px system-ui;padding:24px}section{display:flex;gap:12px}article{padding:16px;background:#eee;flex:1}output{font-weight:bold}</style></head><body><h1>Where the pressure goes</h1><p>Illustrative inputs, not a model reading.</p><section><article>120 ft duct<br>0.12 in. wg</article><article>Two elbows<br>0.06 in. wg</article><article>VAV allowance<br>0.25 in. wg</article></section><p>Losses in series add: <output>0.43 in. wg</output>.</p></body></html>'})

The one result supplies the open URL and screenshot. Replace the assumed values only after an actual model reading. A prose-only explanation or an unbound-example link is not delivery.

1. For a new explanation, call pe_do with kind page directly. For adapting an existing Page, discover and read its canonical key first. Update a scratch Page by publishing its slug again; the host keeps its shared state and binding.
2. Inline CSS, JavaScript, and SVG are sufficient. /pages/pe.js and pe.kit are available when the Page needs host state or richer controls. Keep the explanation focused; do not fetch their source for a simple illustration.
3. For model-backed work, use pe.target(), pe.read(key) and pe.do(key, input). Keep the host Bind chip. Never choose Revit session/document headers, imitate Pea, or hide a refusal. Binding is required before model reads or actions, not for an assumed-input illustration. The Page must draw without throwing while unbound, or the publish fails. pe.js has five more doors, and this is their whole contract; do not go looking for its source. pe.fetch(url, init) is fetch for a Page's own request to a host API route; the host refuses a browser API request made with plain fetch. pe.find(words, { kind }) answers catalog rows { key, kind, title, description }, ranked as pe_find ranks them. pe.reading(source, run) awaits run() and answers { source, at, rows }: rows is whatever run answered, source is your name for where it came from (the op or script key), at is the time in ms. It saves nothing; fire the reading into the log (step 4) to keep it. pe.picture(elementIds) boxes a 3D view around the elements and answers its image as { url, sha, at, viewId, viewName, registration, marks, notDrawn }; it is a mutation and runs as pe.do does. pe.diff({ script, input, expect }, parameterNames) runs a script ReadOnly and then for real, and answers what it changed: { elements: [{ id, change, name, category }], rows: [{ id, change, parameter, before, after }] }.
4. Shared state is one call: const k = await pe.state({ reduce, base, render, describe, local: [] }). The event log is the authority, and every copy of the Page and every agent replays it. The log belongs to this one Page: no pe.js door reads another Page's log, and pe.read, pe.do and pe.script take op and script keys, never a page: key. A Page that shows what another Page shows runs the same op or script by key and keeps its own log. reduce(state, event, meta) gets meta = { origin: "page" | "agent" | "person", seq, at }; render(state) draws; describe(state) returns the markdown an agent reads. k.fire(event) of a shared event returns a Promise: the host keeps the event, then it is reduced with the host's seq and time, so await it or ignore it and never branch on its value. A type listed in local applies at once in this copy only. The events an agent may append are declared once, in the Page's HTML, not in the pe.state call: <script type="application/json" id="pe-agent">{ "<type>": "<one line: what it means and its fields>" }</script>. The host reads that block from the Page file, so you can append before any browser has opened the Page, and an append of any other type is refused with that list. You read a Page with pe_read page:@..., which answers { seq, text, textSeq, agent, events, target }: text is describe's output as of textSeq, and events is the tail (pass after to page back). You append with pe_do page:@... { event }, stamped origin agent.
5. Read actual observations before presenting model claims. Label illustrations and stale observations. The publication call already validates and captures the Page; use its returned URL and image instead of rediscovering or reopening it. A capture proves what rendered, not engineering correctness or a Revit action. After a model edit, obtain an independent reading and its receipt.
6. A scratch Page worth keeping, sharing or giving scripts becomes a Pod: op:pod.promote moves it into a new Pod as pages/<slug>/ (the scratch copy is removed and its event log does not follow), and build-pod takes it from there.

pe.target(): the document this page's binding names: { session, openId, title }. pe.doc: The bound document { session, openId, title }, after pe.target().
The document this page's binding names, as the host resolves it now; sets pe.doc. A binding that names no one document (no binding, a pinned file open twice or closed, a thread pointed nowhere) is thrown as a PeTargetRefusal with the resolver's word as code (ambiguous, document-closed, session-gone, missing) and shown on the page; nothing is ever picked for it. Bind the page from the chip.

pe.state options: { reduce, base, render = () => {}, describe = () => "", local = [] }. reduce(state, event, { origin, seq, at }); declare agent events in script#pe-agent[type="application/json"]. k.fire(event) waits for a committed row; nav and local event types stay in this tab. The returned k has k.state and k.fire(event).
`,
  },
  {
    name: "survey-revit-model",
    content: String.raw`---
name: survey-revit-model
description: Survey what is open before touching it. Use when the user asks what is in the model, what is open, selected, loaded, visible, or scheduled, asks for an audit or a report, or pastes a Revit problem without an instruction. Reads only; it ends by naming the next move.
---

# Survey Revit Model

Writes are off. The product is a map of what is actually there, in the user's words, with the difference between what they believe and what the model says stated first.

## Method

1. Restate the question in your own words and name the scope: document, view, level, category, or selection.
2. Confirm freshness first: which document is active and whether the session is current.
3. Pace it once wide with the smallest orientation surface (context, catalog, or matrix operations), then zoom into the two or three places that decide the answer.
4. Every line of the report carries its stake: the operation or script that produced it and the document or view it came from. A plausible count is not a stake.
5. Broad inventories go to an artifact; the reply carries the findings and the exceptions.

A small question gets a one-sentence answer with its stake. A full survey reports scope, evidence used, findings, what was not inspected, artifacts, and the next move: a change to draft, a diagnosis to run, or a decision the user owns.
`,
  },
  {
    name: "diagnose-revit-behavior",
    content: String.raw`---
name: diagnose-revit-behavior
description: Find the cause of strange Revit behavior before proposing a fix. Use when something is hidden, missing in one view but present in another, different between views, wrong in a linked model, controlled by a template, failing, or slow. Ends with a cause and its evidence; the fix is the user's call.
---

# Diagnose Revit Behavior

The model does not lie and cannot be treated. The only product is the cause, from live state, with the evidence that proves it. A fix before the cause is a guess wearing a change.

## Method

1. Build the smallest reproduction: one element, one view, one question the model can answer now.
2. List the candidate causes and, for each, the inspection that would kill it. Kill the cheap ones first.
3. Inspect live state before generic Revit advice. Distinguish observed facts from hypotheses in every sentence.
4. A hang or timeout is a boundary, not a failure: name what it was waiting on.

## Visibility causes to test, cheapest first

View type and template controls, discipline, detail level and display style, phase and phase filter, design options, worksets, category visibility, view filters and overrides, element hide and isolate, temporary modes, crop, scope box, and section box, plan view range, plan regions and underlay, link visibility, display mode, linked view, and load state, imports and point clouds, graphics settings. View collectors report candidate drawn elements, not pixels on screen; use a view capture when the pixels matter.

Report the cause, the evidence that proves it, what would turn it green, and what was not inspected. The user decides the fix. A cause that is one sentence stays one sentence.
`,
  },
  {
    name: "settle-intent",
    content: String.raw`---
name: settle-intent
description: Interview the user until a change or a Pod is settled enough to act on. Use before any mutation, layout, migration, or Pod build whose targets, standards, or trade-offs the user has not stated, or when the user asks to align, decide, or be pushed back on. Not for facts you can inspect.
---

# Settle Intent

Decisions are the user's; facts are yours. Do not ask a question an inspection could answer, and do not make an engineering choice you could hand to them.

## Method

- Answer their question first if they asked one.
- Look up the facts in the same round, then ask the whole frontier at once: every open question whose prerequisites are settled, numbered, each with your recommendation, so the user can answer "1. B, 2. yes".
- Stress the boundary: before it settles, test one scenario that forces it against the current model or project standards, and surface every contradiction.
- Read back each verdict as you understood it before acting on it.
- Stop when nothing is left silently assumed and the user confirms. Then name the next move.

Format each question as the title, the question with its choices, and your recommendation on the next line.
`,
  },
  {
    name: "prove-revit-change",
    content: String.raw`---
name: prove-revit-change
description: Verify a change on the real model before calling it done. Use after any mutation, script, or Pod run, before reporting "done", and whenever the user asks whether something really worked or to be skeptical. Ends with a stamped verdict, never with "should work".
---

# Prove Revit Change

Plausibility is not proof. A successful call proves that the call completed; the model is proven by reading it back.

## Method

1. Write the falsifier first: the read, count, capture, or schedule row that would show the change did not land.
2. Read it back from the live document, fresh, after the change. A stale snapshot or the request payload is not a readback.
3. Name the lane: a document readback, a rendered view capture, a schedule value, or a file on disk prove different things. Visual proof is its own lane.
4. Stamp the verdict: PROVEN with what was read and when, FALSIFIED with what broke, or UNPROVEN with why. Fewer than that is void.
5. Rank by consequence: one wrong element outranks twenty cosmetic misses.

Report the verdict with its readback. Skipped or failed items and what remains unproven are listed only when there are any.
`,
  },
  {
    name: "teach-revit-mechanism",
    content: String.raw`---
name: teach-revit-mechanism
description: Teach a Revit or Revit API mechanism the user wants to own. Use when the user asks to learn, understand, or be taught something, or asks the same question a second time. Not for a one-off answer.
---

# Teach Revit Mechanism

The user asked to learn, not to be told. The master corrects the hand and never touches the work.

- Ask one question first if the use is not obvious: what will you do with this? Teach toward that use, in plain words, at their altitude.
- Hand over one short artifact they keep: the load-bearing fifth, a dense example beside its explanation, the rest linked.
- Cite primary sources: Revit API docs, observed model behavior, or a script they can rerun. Never teach from lore.
- Explain by physical shape: document versus view, type versus instance, family versus project, what persists where.
- Check transfer, not recall: they apply it to their own model before it is done.
`,
  },
  {
    name: "write-revit-csharp-script",
    content: String.raw`---
name: write-revit-csharp-script
description: Write and run a C# Revit script when code is the clearest way to inspect, mutate, or experiment against a connected model. Use for one-off probes, gaps in host operations, and durable multi-step work. Covers inline snippets and workspace files; build-pod owns scripts that live in a Pod. Not for changing values a route shows (family or type parameters, schedule cells, takeoffs, parameter links); edit those with edit-shared-work and use their semantic apply command.
---

# Write Revit C# Script

## Method

- Start with pe_find to establish the exact connected document and capability. Do not create or register a script without a connected document. This includes .cs drafts, reusable audits, ReadOnly scripts, and Pod entrypoints for future models. If discovery fails or there is no document, report the missing target and return the proposed contract in the reply only: purpose, inputs, read/write mode, expected artifact, and the readback that will prove it. Write no source file yet.
- Choose a script when no host operation is the smallest capable surface. Bootstrap the workspace when paths or references are unknown.
- Inline snippets for tiny probes; workspace files for durable or multi-step work.
- Default to ReadOnly. Use WriteTransaction only for an explicit, user-authorized mutation. Use NoTransaction only for APIs that reject an open transaction.
- Pea's ReadOnly target needs read consent. Unpaired external MCP clients cannot run scripts, including ReadOnly; paired external clients still need write authority on the script's target. WriteTransaction and NoTransaction on any open document run without asking; there is no per-call or per-document approval to ask for. Never script a synchronize, an in-place save or a close of a project document: those are the person's acts, and Pe's own commands return them held. A thread may target several documents; a script names one. Any script refuses while another open document in that Revit is one Pea may not write; name those documents to the user.
- Treat compiler and runtime diagnostics as steering; fix the first one before rerunning.
- Scope every collector to the categories or classes you need. When you must read parameters across many elements, iterate element.ReadableParameters(), never element.Parameters: some models carry hidden built-in parameters whose StorageType read kills Revit outright, and no catch or rollback survives it.
- Keep terminal output compact; write artifacts for broad evidence. Return structured results for anything a later step reads.

Building or fixing a family from a cut sheet follows build-revit-family.

A script worth keeping becomes a Pod entrypoint. skill:@product/skills/build-pod is the one account of that: the manifest, a script's input, its declared mode, the files it reads and the key every door runs it by.

For a probe, report the answer and the permissionMode it ran under. For a mutation, add the script path, diagnostics, and the verification readback.

Worked example: to audit missing diffuser neck sizes, first read the connected project and identify the exact neck parameter. Only then create a ReadOnly script that returns grouped rows by family and type; do not register a Pod entrypoint until that first run produces the expected artifact.
`,
  },
  {
    name: "build-revit-family",
    content: String.raw`---
name: build-revit-family
description: Build, extend, or fix a Revit family from a manufacturer cut sheet or submittal. Use when the user asks to build out, rebuild, add types, sizes, connectors, clearances, or accessories to a family, or to make a family match a spec sheet.
---

# Build Revit Family

A family is a spatial claim. Counts and flexed formulas prove that numbers hold, never that a solid sits on the side the drawing shows. The user should never have to be your eyes.

## Method

1. Attach the sheet. Save the family first: stage writeIntent["family.capture"].edit = { "value": { "pod": "<pod>" } } in Family Work and run family.capture with the Work handle; its result is the saved member. Then pe_do key=family.attach-spec with that member and source { "path": "<absolute PDF path>" } or { "url": "<PDF url>" }. A value you stage from the sheet cites it: cells.<pointer>.edit = { "value": ..., "sources": [{ "blockId": "<block id from the attached spec>" }] }. Tables give sizes; drawings give sides, offsets, and which openings exist. Read the page renders in the Pod spec folder as images, not only the text.
2. Inventory before building, then align on it: every size column is a type; every opening drawn is a connector (supply, return, outside air, each pipe, drain, power); every option is a Yes/No toggle; every clearance zone is a block. A ruling about one axis never removes items on another: "no three-phase" removes electrical variants, not cabinet sizes. Ask.
3. Parameters: search the parameters service cache for PE_ shared parameters first (PE_G_Dim_*, PE_M_Fan_AirFlow, PE_M_PerfCool_CapacityRated, PE_M_Fan_Filter, PE_E_*). Create a family parameter only when no PE parameter fits, and name it in your report. Sheet dimensions are type parameters.
4. Clearances: nest the company clearance family (!Mechanical Equipment_Clearance_Rectangular_UH in the PE library, or the one the user names) once per zone, always on. Ask before modeling clearance as plain solids.
5. Verify after every geometry write: family.look with the family's Yes/No toggles, then read the plan and the connection-side elevation beside the matching page. Check in its census that every inventory connector exists in every type and toggle state. Before calling it done, run family.loadTest and read its warnings, duplicate names, and images. A PROVEN without both is UNPROVEN.

## Gut check first

Parameters are the obvious review. What a project feels when the family loads is the connectors, the toggles, the orientation and the nested families, and that view decides what the parameters beneath must be. Write it before you align and again before you report done, per type and per toggle state:

- Every connector: domain, system classification, flow direction, shape and size, and the family parameter that drives each of its size, flow, pressure drop, voltage and load. A connector whose size or flow nothing drives is a finding, not a detail.
- Every toggle and variant: which solids and connectors each state shows, and which connectors stay in the project unconnected while the option is off.
- Orientation: the hand, which side the connections and the control box sit on, where the origin is, and what the flip controls do.
- Nested families by name, shared or not, and what each one schedules as.

Census this with a script when the look census does not carry it; never report it from memory.

## Sheet letters

- A cut sheet's lettered dimensions are labels local to one drawing and its table, never identities. The same letter often means different things on different pages: on the Magic Aire HCB submittal, L is the supply opening height for sizes 04 to 20 and an offset for 30/40, where J is the height.
- For each table, map every letter to its meaning by finding where its drawing dimensions it. Name parameters by meaning (Supply Opening Height), never by letter. Show the per-table map when you align; a letter whose meaning changes between tables is a finding.
- Check each mapping against the cabinet: an opening must fit inside its face, and its offsets plus its size must not exceed the face.

## Accessories

Mixing boxes, filter racks, curbs and their top, back and bottom variants have no free shape. Present the three shapes with their costs and let the user choose, per family or as a company standard:

- Nested family behind a Yes/No toggle keeps the accessory schedulable with its model-number types. Its connectors are not the host's, so each needs a host stub and a host connector. No connector can hide, so every variant's connectors stay in the project unconnected while that option is off; three outside-air variants mean three dangling connectors. Users must remember the toggles.
- Host geometry is the simplest and carries fully through family capture. The accessory is no longer a schedulable element of its own, and its connectors still dangle when the option is off.
- A model group of separate families, placed together and ungrouped after placement, keeps each part's own connectors and schedule rows, and nothing dangles. The parts are not driven by the host's size parameters, and edits happen after placement.

## Revit laws

- A connector inside a nested family is not the host's connector, and no connector can be hidden. An accessory opening (a mixing box outside-air collar) needs a host-owned stub extrusion that copies the collar footprint, with the connector on the stub's face; the stub follows the toggle, the connector stays.
- A connector hosted on a nested instance face does not follow the instance. Host it on a host extrusion locked to formula-driven planes.
- Nested families with one name merge into one loaded family in a project. Give every nested family a unique name.
- A rectangular connector's width axis comes from the host face, not the edge argument. Rotate it about its normal, then census the width direction.
- A nested family's type slot cannot be associated. Make its size parameters instance and associate those.
- A value set before a dimension is labeled does not drive it. Set it again after labeling.

Report the inventory with each item built or not, the PE and family parameters used, and the look and loadTest verdicts with the image paths you read.
`,
  },
  {
    name: "build-pod",
    content: String.raw`---
name: build-pod
description: Turn a repeated workflow or an add-in idea into a shareable Pod, or adapt a Pod the user already has. Use when the user says "make this a Pod", "automate this", "every week I have to", "share this with my team", "update my Pod", "my Pod stopped working", or when the same script has run twice. Shape first, then make it real, then delete what did not earn its place.
---

# Build Pod

The user supplies intent and ideas; you handle the code. Nothing that does not connect to the workflow, nothing longer than it must be.

For a Pod with Revit script entrypoints, pe_find must first establish an exact connected document target. Without it, return the proposed workflow and script contract in the reply; create no source, manifest entrypoint, or registration yet. Preparing reusable code for future models is subject to the same preflight.

## What a Pod is

A Pod is one folder under Pods/<folder>/ in a content home. It holds pod.json and authored files: C# scripts, Pages, skills, settings, assets and guides. Everything a tool needs travels in that folder. A folder without pod.json is not a Pod. The host admits one bounded membership set; build debris, run output, Page state and binding authority are machine state and never sit in the Pod.

pod.json holds schemaVersion (2), id, name, version, description, entrypoints, and an optional for; write nothing else in it. Libraries offer operations for JSON members; do not bind a JSON file to an operation in the manifest.

### Scripts: one key, every door

An entrypoint is { "sourcePath", "name"?, "description"?, "mode"? }. sourcePath is any .cs or .csx file of the Pod at any path, src/Compare.cs or pages/tour/checks/taps.csx alike. The file is a PeScriptContainer class or a bare statement body. The Pod's other .cs files compile beside it, so a shared helper is a static class in its own file.

- mode is ReadOnly, WriteTransaction or NoTransaction. Declare ReadOnly on every check and report: a ReadOnly entrypoint is a read, you run it with pe_read, and any caller asking it for a write mode is refused. An entrypoint with no mode lets the caller choose and writes by default.
- Input is one JSON object, at most 256 KiB, handed through unchanged by every door. Read it with Arg<T>("name") or Arg<T>("name", fallback); the raw object is Input (a JsonElement). A missing or ill-typed argument throws in plain words naming it. Give a fallback wherever the palette button, which sends no input, should still do something useful.
- PodFile("assets/Tag.rfa") answers the absolute path of a file of the running Pod. Never write an absolute path in a script; it breaks the moment the Pod is shared.
- Result(value) is the script's answer. Every door answers exactly that value.

The key is script:@<id>/<sourcePath>, and three doors run it with the same input and the same answer:

- A Page: const rows = await pe.script("src/Compare.cs", { input: { a, b } }). Bare paths and leading / resolve from the Pod root; ./ and ../ resolve beside the Page's index.html. pe.do("script:@<id>/src/Compare.cs", { input }) is the same call. Options are input, mode and timeoutSeconds. It answers the Result value and throws with the compiler's or runtime's own words; the full run record is on the error and on pe.lastRun.
- You: pe_read script:@<id>/<path> { input } for a ReadOnly entrypoint, pe_do script:@<id>/<path> { input, permissionMode, timeoutSeconds } for the rest. The catalog row carries the declared mode.
- A person: the palette button described below.

Declare every script a Page runs. An undeclared path that matches a declaration under the other base is refused with "did you mean /<declared path>?"; only a path with no such match is refused with "declare <path> in pod.json entrypoints". Inline source (pe.script with a multi-line string) is for scratch Pages and probes only: it has no key, so you could not run the check the Page shows, and the person and you would be reading different things.

Page script signature: pe.script(keyOrPath, { input, mode, permissionMode, timeoutSeconds = 120 } = {}). input is one JSON object the script reads with Arg<T>("name"). mode is ReadOnly (every change rolls back), WriteTransaction (one host-owned transaction) or NoTransaction (the script owns its transactions); a declared entrypoint runs in the mode pod.json gives it, and inline source runs ReadOnly, unless you say otherwise. Answers what the script gave Result(...). Throws with the compiler's or the runtime's own words when the script did not succeed; the whole run record (status, diagnostics, output, artifacts) is error.run and pe.lastRun.

### Pages: files in the Pod

A Pod's Page is the file pages/<page>/index.html: plain HTML that loads /pages/pe.js. To see a working one, read a shipped example Pod in the Pods folder of the home you write to (pe_find kind page lists them, for example page:@document-profiler/pages/profile). Never model on a source checkout: an installed machine has none, and the host's status path is not a place to read. Write and edit it with your file tools in the Pod folder, with any files it needs beside it. The pe_do Page call writes scratch Pages only and cannot place a Page in a Pod. The key is page:@<id>/pages/<page>; find it with pe_find after writing and open the address that row gives. Nothing restarts: a Pod or a file you write is seen on the next discovery. A Pod may hold several Pages; each has its own key, binding and event log, and none reads another's.

Page code is what skill:@product/skills/make-page steps 3 and 4 describe (pe.target, pe.read, pe.do, pe.state, and pe.fetch, pe.find, pe.reading, pe.picture, pe.diff), plus pe.script by key. Three rules make a Page something you can use as well as a person:

- It draws unbound without throwing, and never names its own document. The chip binds it.
- What a script answered goes into the event log unchanged, for example await k.fire({ type: "compared", rows }), so the rows on screen are the rows you get from the same key.
- Its HTML declares the events you may append in a <script type="application/json" id="pe-agent"> block (make-page step 4), and its describe text says what the Page currently shows.

### for: a tour of one model

"for": { "title": "<document title>", "probes": [{ "elementId": 123, "uniqueId": "..." }] } says the Pod's content is one model's elements. Its Pages and every run of its scripts then refuse on any other document with "this Pod is for <title>; the bound document is <title>". Leave for out of a tool, which must run on any model; add it only when the Pod stores that model's element ids.

### Skills: what you will know next time

skills/<name>/SKILL.md, with name and description front matter, is the only guidance in a Pod that reaches an agent. AGENTS.md and README.md are for people reading the folder. Write one skill per Pod: its keys, each entrypoint's input and answer, the events its Page accepts, and what it must never be used for.

## Identity: three facts

- The folder path is an address. Renaming or moving it does not change identity. Use the discovered folder when executing; never derive it from the manifest id.
- The pod.json id names the package. Conflicting installed ids refuse; give an adapted derivative a distinct id.
- Each member's SHA-256 identifies its exact bytes. It is derived on read, never stored. The human version is a label, not an update policy.

Canonical keys are script:@<id>/<sourcePath>, page:@<id>/pages/<page>, skill:@<id>/skills/<skill>, and member:@<id>/settings/file.json. sourcePath is script identity; no entrypoint id or folder alias survives. A member: key is data and never executes. Address operation inputs as { pod: <id>, path: <relative path> }. Members are read/mention-only. Other admitted support files remain readable package members.

## Compose, share, and adapt

$include and $preset compose members. @local/<path> resolves inside the same pod's settings/; @<id>/<path> resolves in the installed pod whose manifest id matches. Two pods with the same id fail and name both folders. There are no hash pins and no precomposed releases.

Publishing vendors: every foreign fragment a member consumes is copied to settings/_vendor/<id>/<path> and its reference is rewritten to @local/_vendor/<id>/<path>, so a published pod composes from its own bytes. Import extracts the archive unchanged; its record (archive sha256, archive name, date) is this machine's state, never a file in the pod. Edit vendored copies only when you mean to diverge from the source pod.

Pod preparation gates only pod.json and entrypoint source. Members validate one at a time when used; one bad member never hides its siblings.

There are three content homes: the user's, the project's and the firm's. Pods, Pages and Catalogs come from all of them, and an id two homes claim is refused with both paths named. There is one write door: a write lands in the home the pod came from, and a stale hash is refused. The user home holds no preferences. Do not recreate the old module settings hierarchy or migrate user files implicitly. Cache, credentials, installation, and transient runtime state are resolved separately from user content.

A member's $schema URL is the only thing that says what it is for: /schemas/settings/<library>/<root>.json selects the library schema and semantic validator. Filenames and folders select nothing. JSON without $schema is plain data; the consuming operation still owns validation before applying it. Structural schema checks run offline in the host; composition previews and semantic checks need a Revit session and report that reason when none is attached.

APS Parameters Service is the sole authority for shared parameter definitions. Retrieve current definitions only when the selected library operation consumes them. The library validates compatibility; storage validates portable structure. An unrelated member's unavailable service must not block this operation. No bundled or cached authority fallback.

Every apply and every entrypoint run writes receipt.json to this machine's state, in Runs/<pod id>/<runId>/, never into the pod: pod id, member path, member SHA-256, op id, plan hash, outcome, and output references. Write useful reports with Artifacts.WriteJson/WriteCsv/WriteText; they land in that same run folder, and return values alone are not a durable file. Inspect diagnostic files after Family Foundry or Schedule runs to refine the authored JSON. Outputs, cache, credentials, and installed binaries are not published. Copy the run folder when sharing output with attribution.

## Every entrypoint is a button

A declared entrypoint appears in Revit's Do palette, on the Scripts tab, with two actions: run safe, where document changes are discarded, and run full, where they are kept. The palette rebuilds its list each time it is summoned, so a new entrypoint appears without restarting Revit. It runs in-process on the Revit lane using the host-admitted frozen input; unavailable host admission refuses with its reason.

The entrypoint name and description in pod.json are the button label and its subtitle, and the Pod name is the filter pill. Write all three for the practitioner who presses the button, not for yourself. An entrypoint with no name shows its sourcePath. A Pod whose pod.json is invalid does not appear on the tab at all, and the user cannot see why from Revit, so validate the manifest before you hand it over.

A Pod is not a compiled add-in. The ladder is: a script proves the idea, a declared entrypoint makes it a button, and a typed host operation is the promotion after that. The last rung is a repo change and an add-in rebuild, not session work; say so when the user asks for it.

## Loop

1. Name the nouns from the user's workflow, not from the API: what they start with, what they want at the end, what they decide along the way. Settle the intent before anything compounds.
2. Choose the shape. When the ask already says what the Pod holds, what goes in and what it does, that is the shape: build it, and say in the reply which shape you took. Do not ask; a question ends a one-shot turn with nothing built. Only when the shape is open, lay out two or three side by side, from one inline probe to a Pod with a Page and several entrypoints, say what each makes impossible, and let the user pick.
3. Bootstrap the workspace, then make the chain real end to end on the real model: one entrypoint run by its key, one readback, before any polish; then the Page that calls the same key. Stubs and placeholders are scaffolding; count them and strike them one per round.
4. Drive the whole workflow on real parts: run every entrypoint by key with real input, then pe_read the Page. With a person in the turn, end with them pressing it themselves, in the Page or the palette. With no person in the turn, report what you ran and read back, and name what a person has still to press.
5. Purge: delete anything the working Pod does not need. Keep the why in a short README the user can hand to a colleague.

## Adapting an existing Pod

Read pod.json, the entrypoints and the Pod's skill before touching anything. To change a shipped or shared Pod, copy it under a new manifest id first. Run the current entrypoint ReadOnly to see what it does today, name the change in the user's words, then change one entrypoint at a time and read back. A Pod that stopped working is diagnosed from its compiler and runtime diagnostics first, not rewritten.

When more than a sentence is needed, report what the Pod does in the user's words, which palette entry runs it and under which action, what it will not do, and what remains scaffolding.
`,
  },
  {
    name: "edit-shared-work",
    content: String.raw`---
name: edit-shared-work
description: Edit shared tool Work and apply it through the same semantic commands the person uses. Use for parameter values, families, schedules, takeoffs, parameter links, and pod members.
---

# Edit shared Work

1. Discover the tool and read route:<tool> with an exact target or workspaceId. Thread targets supply defaults only.
2. Read the revision and schema. Call route:<tool>.edit with expectedRevision and patches to the cell's one staged edit. A patch path is an array, such as ["cells", "<key>", "edit"]. Set {value: ...}; clear with null. Host stamps the author, time and base revision. Never patch observation, basis, readback, consent or receipts.
3. Either author may knowingly replace the current edit. A stale revision refuses; reread and submit a new explicit edit. Suggestions are optional review content, available to either author.
4. For Families, set scope.edit with exact loaded family names before writing its cells. Keys are the SubjectRef name:["<familyName>","<typeName>"]#field:<parameter>. The host validates those identities against Revit.
5. Run the semantic apply/save/push/sync command yourself when the user authorized execution. Family apply accepts {source, include: "all"}, several sources, a prior preview plan id, or the reviewed Work drafts when no source is supplied. The host plans, checks freshness, applies, reads back and retires only unchanged consumed edits. Preview is optional inspection, never an actor gate.
6. Nothing asks the user before a write: an admitted command runs, and Stop cancels this thread's pending and unstarted mutations. Three acts on a project document are the person's and come back held at once, not done: synchronizing with central, saving over or discarding the model's state (an in-place save, or a stop, close, reset, restart or cleanup over unsaved changes), and sending a file's bytes to an outside service. A held result is not a refusal: say what is waiting on the person and continue. Work edits and internal evidence remain immediate. Keep the original actionId through retries, and inspect uncertain native outcomes instead of submitting a replacement.
7. Report completed work and exact tool/Work links. If accepted commands still run, say so. External devices and Pages keep their own trust adapter.
`,
  },
  {
    name: "calc-duct-pressure-drop",
    content: renderDuctsSkill(),
  },
  { name: "edit-schedule-grid", content: renderSchedulesSkill() },
  { name: "edit-loaded-families", content: renderFamiliesSkill() },
  { name: "edit-family", content: renderFamilySkill() },
  {
    name: "place-mep-ducts",
    content: String.raw`---
name: place-mep-ducts
description: Lay out ductwork in Revit - rough in a supply, return, or exhaust trunk on a level, branch to air terminals, draft a collision-free layout the user can refine, then commit real ducts and fittings. Use for lay out ductwork, run a duct, rough in supply on a level, route duct to these terminals, duct clash check.
---

# Lay Out MEP Ducts: DECLARE -> SOLVE -> DRAFT -> DIFF -> COMMIT

You do not hand-draw ducts. You DECLARE intent as JSON; the Pe.Revit.Placement library routes collision-aware paths on a lattice and DRAFTS native placeholder ducts (visible; the user can drag them); you read the report and a plan image, refine the intent, re-SOLVE and read the DIFF; when it is clean you COMMIT real connected ducts and fittings. Use these five words with the user and repeat them when reporting.

Pe.Revit.Placement is an explicit-reference library already available in the scripting environment. Drive it from short scripts via pe_do key=op:scripting.execute - one tiny script per step. Solve, Commit, and Cleanup need permissionMode WriteTransaction; Scout, MapProbe, and ExportPlan are read-only. Every method returns its full report as text: WriteLine it and read it.

    using Pe.Revit.Placement;
    var place = new DuctPlacer(doc, "L3");   // level name or id; plan and 3D views auto-resolve
    WriteLine(place.Scout());                 // recon: terminal ids, connector z, existing duct band, level convention

## Clarify before declaring (ask, do not guess)

1. Level, system (Supply Air / Return Air / Exhaust Air), and zone: which rooms, from where to where.
2. Trunk size (default 12x8 in) and elevation above the level (default 9 ft centerline). Scout prints the level's existing duct band - match it or dodge it deliberately, and say which.
3. Terminals to serve, and connect vs near: in finished models terminals are already fed, so drops end about 1.8 in short (near-connect). That is the expected, correct outcome, not a failure. The bound is 6 INCHES: any path end more than 6 in from the connector it serves is unfinished routing, not a stub - never call it done, and never round a missing vertical leg down to a stub.
4. Where the air comes from or goes to: if an endpoint is equipment (fan, AHU), its connector has its own z - Scout prints it. A trunk at elevationFt does not descend to equipment by itself. Either run the trunk band at the equipment connector's z, or close the vertical with the Verbs session (StartAt at the equipment XY, RiseTo the trunk z, Toward the run). Check the reported endpoint z against your trunk z BEFORE calling anything connected.
5. Keep-outs (shafts, pads, future equipment) become constraints.keepOut boxes.

Hand back when the user wants specific fitting families, sloped or insulated duct, sizing calcs, or edits to EXISTING ducts. This ability only places new PEA-TK-PLACE-tagged geometry. Stop and ask when the same intent fails twice - show the refusal diagnosis verbatim.

## The loop - THREE scripts, not ten

Tool calls are your scarcest resource: each one costs a full round trip, and a placement that spreads intent-probe-solve-commit across separate calls will run out of turn before it commits. The library is in-process, so everything after recon fits in ONE script.

1. SCOUT once per level (read-only). Endpoints and terminal ids come from Scout, NEVER from an image. Do not export or read images during recon.

    using Pe.Revit.Placement;
    WriteLine(new DuctPlacer(doc, "L3").Scout());

2. PLACE - one WriteTransaction script that declares the intent inline, probes, solves, and auto-commits when clean. This template is the whole step; fill in the intent and go:

    using Pe.Revit.Placement;
    string intent = """
    { "name": "run1", "system": "Exhaust Air",
      "trunk": { "size": "10x6", "elevationFt": 9.0, "from": [384.5, 660.9], "to": [340.0, 665.0] },
      "branches": { "sizeIn": 6, "terminals": [6085577, 6612609], "connect": true } }
    """;
    var place = new DuctPlacer(doc, "L3");
    WriteLine(place.MapProbe(intent));
    WriteLine(place.SolveAndCommitIfClean(intent));
    // Clean draft -> committed + kept + plan exported, one call. Dirty or refused -> the report
    // names the blocker and the draft stays; edit ONE intent lever and re-run this script.

3. ITERATE or VERIFY. Refused or dirty: edit ONE lever in the intent (elevation first) and re-run script 2 as-is. Committed: read_image the exported plan once to confirm, then report. That is the whole loop.

A failed solve rolls back and the previous draft survives. Commit converts the placeholders that are IN THE MODEL (user hand-drags honored) into real ducts, elbows, takeoffs, and terminal connects, then rechecks collisions. Keep() retags the committed increment PEA-TK-DONE so the next Solve does not delete it. Cleanup deletes every PEA-TK-PLACE element (kept ones stay): new DuctPlacer(doc, "L3").Cleanup();

Bias to a thin first commit: get ONE collision-free draft committed rather than perfecting elevations and clearances first. Refine after the user sees something real. A clean rough-in beats a perfect un-committed plan, and it fits the time you have in one turn.

Commit is a checkpoint, not a finale. On multi-part work (trunk plus branches, several rooms, a vertical leg to equipment) commit each part as soon as its report is clean, call Keep() to lock it in, then Solve the next part - Solve DELETES everything still tagged PEA-TK-PLACE, so an increment you committed but did not Keep() is wiped by the next solve. Kept elements survive interrupted sessions and become ordinary obstacles for later solves; re-solve-to-replace only works on the increment you have NOT kept yet. If you are running out of time, commit and Keep what is clean and report exactly what remains, with the ids you would start from.

## The intent (model feet; sizes inches; unknown fields warn; bad values name valid options)

    {
      "name": "L3-west-supply",
      "system": "Supply Air",
      "trunk": {
        "ductType": "Rectangular Duct: Mitered Elbows / Taps",
        "size": "12x8",
        "elevationFt": 9.0,
        "from": [-98, 1.5],
        "to": [-40, 1.5]
      },
      "branches": {
        "ductType": "Round Duct: Taps",
        "sizeIn": 8,
        "stubFt": 1.5,
        "terminals": [1441161, 1442230],
        "connect": true
      },
      "constraints": {
        "avoid": ["mep", "walls", "structure", "equipment", "terminals"],
        "clearanceIn": 2,
        "maxBends": 8,
        "gridFt": 0.5,
        "keepOut": [ { "name": "future shaft", "min": [-70, 0], "max": [-66, 4] } ]
      }
    }

trunk.elevationFt is CENTERLINE feet above the level; match Scout's duct-band line. trunk.from/to are [x,y] model feet or an element handle. terminal ids come from Scout.

## Reading the report (route grammar)

- HIT with an obstacle z-span is a hard collision, named blocker with id and box. Each HIT carries a computed fix line - elevationFt values you can paste, or an avoid or keepOut edit. Values are approximate (bbox math): re-solve to confirm, do not argue with them.
- PASS is a wall penetration while walls is deliberately out of avoid - a human decision; flag it.
- NEAR is clear but within 12 in (TIGHT if under clearanceIn). Watch, do not chase.
- CLEAR, or a VERDICT of clear to commit, means proceed.
- The scan ALWAYS checks every obstacle group PLUS linked models (structure, architecture), regardless of avoid; avoid only steers the router. The report never lies by omission - trust it over your own guess about clearance, and never claim no collisions from a host-only check.
- ENDPOINT GAP means the trunk does not physically reach an element you declared as from or to - the run is unfinished no matter how clean the collision lines read. Apply its fix line (elevationFt or a Verbs riser) before calling anything connected; gap OK (stub range) is the done state.
- TRUNK REFUSED names the binding constraint and the blockers. Fix cheapest-first: trunk.elevationFt (z is the lever - most collisions are elevation problems, and a HIT repeating along the run means change z, never jog), then add the named group to avoid or a keepOut, then move endpoints to lanes MapProbe shows free, then maxBends, and only last clearanceIn.
- DIFF lines (z 41.17 to 40.17, collisions 1 to 0, len +1.8 ft) are the steering feedback - quote them when asking the user for a decision.

## Verbs escape hatch

For interactive nudging or diagnosing a single leg, use the fluent session (StartAt, Toward, RiseTo, BranchTo, then Preview or Commit) from new DuctPlacer(doc, level).Verbs(). Same probe voice, same marker, same draft medium. Prefer intent JSON for anything past a couple of legs - routine refinement is data edits.

## Hard rules

- Only elements with Comments = PEA-TK-PLACE are yours. Never modify or delete anything else.
- Solve, Commit, and Cleanup run WriteTransaction; Scout, MapProbe, and ExportPlan are read-only.
- read_image the exported plan ONCE after a commit to confirm before reporting success. Never read images during recon or between solve iterations - the report and MapProbe are the truth; images are the final visual check.
- On a Revit-busy error: wait, retry a few times, never stack concurrent runs.
`,
  },
];

// Skill directories this product once bundled and no longer does. Materialization removes exactly
// these on upgrade; every other directory under the skills root is the user's and is never touched.
export const retiredPeaSkillNames: readonly string[] = [
  "propose-changes",
  "audit-visible-revit-equipment",
  "inspect-active-revit-document",
  "author-family-foundry-profile",
  "debug-family-foundry-artifacts",
  "validate-pe-settings-workspace",
  "author-pe-settings",
];

/** Codex reads repo skills from `.agents/skills` under its cwd; Claude Code from `.claude/skills`. */
export const peaStandardSkillsRoot = path.join(".agents", "skills");

/** The user home, where `Skills/` is authored; the Documents user root when omitted. */
export interface PeaProductHomeOptions {
  productHomePath?: string;
}

export function resolvePeaProductHomePath(options: PeaProductHomeOptions = {}): string {
  return path.resolve(readEnvPath(options.productHomePath) ?? userRoot());
}

export { publishPeaSkills } from "./skill-publication.ts";

function readEnvPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

---
name: profile-document
description: Find what makes a Revit model heavy or slow with the document-profiler Pod. Run its censuses by key, read the rows, and record them on its Page. Use when asked why a model is slow, what could be deleted, which mechanical plans are unsheeted, what a read of this model would cost, or to profile a document.
---

# Profile a document

The Pod `document-profiler` is a tool: it works on any model. Its scripts are entrypoints, so you and its Page run the same code by the same key and get the same answer.

## Keys

| Key | Mode | Door | Answers |
|---|---|---|---|
| `script:@document-profiler/src/MechanicalPlanCensus.cs` | ReadOnly | `pe_read` | `rows`: one per mechanical plan: `uniqueId`, `name`, `level`, `sheets`, `directlyUnsheeted`, `noRelatedPlacements`, `dependents` |
| `script:@document-profiler/src/Profile.cs` | ReadOnly | `pe_read` | `rows`: element groups by `category`, `family`, `kind` with `observedCount`, largest first |
| `script:@document-profiler/src/ReadCostCensus.cs` | NoTransaction | `pe_do` | `rows`: `subject`, `finding` headlines; each says measured, sampled or projected |
| `script:@document-profiler/src/DeletionExperiment.cs` | NoTransaction | `pe_do` | experiment, see below |
| `script:@document-profiler/src/SaveVariant.cs` | NoTransaction | `pe_do` | experiment, see below |
| `script:@document-profiler/src/ViewOpenProbe.cs` | NoTransaction | `pe_do` | experiment, see below |
| `page:@document-profiler/pages/profile` | | `pe_read`, `pe_do` | the Page's readings and notes |

Every answer also carries `status`, `artifact` (the full evidence file) and `diagnostics`. A `refused` field is the script declining in its own words; relay it.

The mode is declared in `pod.json`, so you never pass one. A ReadOnly key is a read: use `pe_read`. Asking a write mode for it is refused.

## Input

Options are `input` names. Leave a name out to keep the default.

- `MechanicalPlanCensus.cs`: `budgetSeconds` (45).
- `Profile.cs`: `maxElements` (10000, at most 20000), `budgetSeconds` (45, at most 300), `samples` (5, 3 to 15).
- `ReadCostCensus.cs`: `censusBudgetSeconds` (180), `firstTouchSample` (1000), `categoryWalk` (5000), `orientationSample` (2000), `obbSample` (200), `fidelitySample` (500), `chunk` (250), `seed` (20261027). Give `timeoutSeconds` at least 60 above the budget.

Example: `pe_read script:@document-profiler/src/Profile.cs { "input": { "maxElements": 2000 } }`.

A value out of bounds throws with the bounds in the message. Rows are capped at 200; `rowsListed` says how many came back, and the artifact holds the rest.

## Procedure

1. **Bind.** Confirm the thread names one document. If it does not, say so and stop; never pick one.
2. **Read.** Run `MechanicalPlanCensus.cs` or `Profile.cs` with `pe_read`. Run `ReadCostCensus.cs` with `pe_do` only when the question is what reading this model costs; it starts no transaction and stops if the document changes.
3. **Report what the rows say and no more.** A count is inventory, not cost. `null` in a row means unknown, not no. An unsheeted parent plan can have sheeted dependents, so `directlyUnsheeted` alone never means unused; `noRelatedPlacements` is the stronger reading. Name the document title and the time with every number.
4. **Record.** Append what you ran to the Page so the person sees it there marked as yours (next section).

## The Page

`page:@document-profiler/pages/profile` is where a person runs the same keys with the same inputs. Its event log is its state. It keeps the last reading per key and draws its `rows` as a table.

- `pe_read page:@document-profiler/pages/profile` answers the Page's text (each kept reading with its document, time, who ran it and its first 20 rows) and the event tail. Read it before you rerun a census the person just ran.
- `pe_do page:@document-profiler/pages/profile { "event": { "type": "reading", "reading": { "source": "<the script key>", "at": <ms since epoch>, "rows": <the script's whole answer> }, "input": { ... }, "document": "<title>" } }` records a census you ran. Send the answer whole; do not trim or reshape `rows`.
- `{ "event": { "type": "note", "text": "<one line>" } }` leaves a line for the person.

The Page declares only `reading` and `note`, in the `<script type="application/json" id="pe-agent">` block of its HTML; any other event type is refused.

## Experiments

The three experiments delete elements, save a file or switch the active view. They ship disabled and refuse until `src/Settings.cs` names a disposable copy, its original and the acknowledgement sentence, and the bound document is that copy. Input cannot arm them. Never edit `Settings.cs` to enable one on a document the person has not called a disposable copy in this conversation, and never run one to see what happens. When one refuses, relay its words.

After a deletion experiment, no winner is proven by one run: require a benefit above the control variation on every trial, and keep API time, drawing and RAM as separate outcomes.

## Changing the Pod

Copy it under a new manifest id first; never edit `document-profiler` in place. To add a census: write `src/<Name>.cs`, read options with `Arg<T>(name, fallback)`, answer `Result(new { status, rows = ... })`, declare it in `pod.json` entrypoints with its `mode`, and add one row to `RUNS` in `pages/profile/index.html`.

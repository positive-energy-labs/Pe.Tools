---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, recorded as Owed items in the feature ledger.
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**, tracer-bullet vertical slices, each declaring the tickets that **block** it.

Tickets live in `docs/features/<name>/LEDGER.md` under `## Owed`, read the `docs` skill for conventions.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path or ledger Owed line) as an argument, read it in full.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests), vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges**, the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change, rename a column, retype a shared symbol, whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket, green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct, does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Record the tickets in the feature ledger

Write the approved tickets as Owed items in `docs/features/<name>/LEDGER.md`, in dependency order (blockers first):

```markdown
## Owed
- <NN> <title>, the end-to-end behaviour this delivers. Blocked by: <NN, NN | none>.
```

If a ticket genuinely needs more than a line or two (acceptance criteria, a decision-encoding snippet), write `docs/features/<name>/<NN>-<slug>.md` and link it from the Owed line. Default to the line. The spec file is an **agent brief**, five lines, no more:

```markdown
**What to build:** the end-to-end behaviour, in one or two sentences.
**Acceptance:** binding and checkable, a reader must be able to say yes or no, not "seems fine".
**Proof commands:** what to run, verbatim, and what passing looks like.
**Blocked by:** <NN, NN | none>.
**Out of scope:** what this ticket deliberately does not touch.
```

No file paths, they rot. Name identifiers verbatim instead (`FamilyModel`, `build_evidence`) so one grep finds the code.

Work the **frontier**: any ticket with `Blocked by: none`. When a ticket's work lands, delete its Owed line **and scrub its number from every remaining `Blocked by:` list** in the same edit, a dangling blocker number is then always an error, never a completion.

Avoid specific file paths or code snippets, they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

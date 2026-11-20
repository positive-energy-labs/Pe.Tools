# 0058: The home ladder decides where a stored fact rests

Date: 2026-11-20. Status: accepted, not built. Source: kaitpw's ruling 15 of the product-declaration muse, 2026-11-20. Amends the storage amendment of [ADR 0032](0032-value-domains-declared-on-work-cells.md) (rules 1 and 7) with an order of choice. The rules of that amendment stand. Slice S2b of the [product-declaration map](../features/routes/MAP.md) builds it.

## Context

ADR 0032's storage amendment says how a model record is written. It does not say when a fact belongs in one. Two products answered differently. Rooms binds twelve shared parameters, eleven of them to Detail Items, so every detail item in a project carries them. Ducts binds none: a value a person should see goes to a parameter the family already has, and Pe's own facts go to one document record. Ruling 14 moved Rooms to the Ducts answer.

kaitpw, 2026-11-20:
- "generally considering the performance and DX properties of a persistence choice is of critical importance. standardizing a ladder for this conceptually AND IN CODE will make these decisions easier".
- "project parameters should not be utilized when they'll clutter the model. meaning, bc a proj param can only be applied to a category, if the category is too broad like detail elements then its cluttewr. if its mech equip or something then it makes more sense."
- On the Rooms adopt command losing its setup phase: "this seems like a very good side effect, and theres the addition that one entry general means more stability because less reads and less sots".
- On the ADR and the code home: "yes to placement. prove is kinda weird but not sure where would be better".
- On rung 5: "it stands to reason that if its something our tool makes, then users will usually interface with it through our tools, so the lack of visibility of records is not an issue".

## Decision

1. **The ladder.** For each fact a product wants to store, ask in order and stop at the first yes.
   1. Can it be read from the model again? Do not store it.
   2. Is it not applied yet? Work.
   3. Is it a standard of the firm or the project, not a fact about one element? A home file, by tier.
   4. Must Revit's own calculation read it? A Revit entity on the element. This is the only case for one (ADR 0032 storage amendment, rule 7).
   5. Must a person see, tag or schedule it inside Revit? A named parameter the family already has. If none exists, a bound parameter, by the category rule.
   6. Otherwise it is Pe's own fact about an element. The product's one document record, keyed by `UniqueId` (ADR 0032 storage amendment, rule 1).
2. **The category rule.** A parameter is bound to a whole category. Bind one only when the category holds little besides our elements. Mechanical Equipment passes. Detail Items does not. When the category is broad, go to rung 6 and show the fact on our surface.
3. **The default at rung 5.** For an element our tool makes, the answer is no. A person meets that element through our tool, so the fact goes to the document record.
4. **Each home kind answers the same cost questions, as data on the kind:** reads per command, places that can disagree, setup before first use, what a write borrows in a shared model, size limit, and what a person sees in Revit.
5. **The ladder is in code.** The home constructors of the declaration kernel carry the ladder (S2b). One constructor exists per home kind, and each carries its cost answers. The homes table of S5 renders from them. No bound-parameter constructor exists until a product needs one.
6. **The pointer for agents** is one line in `ts/AGENTS.md`, the file that governs the product folders. The owner left the choice between that file and the `prove` skill open, so this default can be reopened.

## Consequences

- A product cannot add a home kind without a constructor, so a new kind is a kernel change that a reviewer sees.
- Beside the ladder, `machineFile` keeps machine evidence and `externalFile` holds named cells in a file whose path the command's input supplies.
- Rung 6 costs what Ducts already pays. Every write borrows Project Information, so two people cannot write the same product's facts in one central model between syncs. The record must fit the 256 KiB cap of the storage amendment, which is provisional until measure M1 of the map reports.
- A fact at rung 6 shows in no tag, filter, schedule or Properties row. The owner accepted that for elements our tool makes.
- Rooms loses eleven carriers, three binding stages and the scan of every Filled Region (ruling 14, [rooms ledger](../features/rooms/LEDGER.md)).
- A person who deletes an element in Revit leaves its entry in the record. A read drops an entry whose element is gone.
- Placement is declared once per command. kaitpw, 2026-11-20: "great, i like ur rec on lands. continue without me". Each command carries one `writes` map from each home to the cells it lands. A cell that no command lands stays in Work, and no cell carries a `lands` line. This keeps ADR 0032's ruling "Placement is derived from what a cell is keyed to, never declared per field".

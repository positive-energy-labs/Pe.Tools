# 0057: An unreadable model record may be overwritten after its bytes are kept and one notice is posted

Date: 2026-11-20. Status: accepted. Source: kaitpw's ruling 5 of the product-declaration muse, 2026-11-19, and the owner's words in the [homes ledger](../features/homes/LEDGER.md) (Decided, 2026-11-19). Supersedes the in-model clause of [ADR 0039](0039-two-failure-policies-by-class.md) rule 1, the words "and in-model owner blobs" in its `keep` list. The rest of ADR 0039 stands. Slice S8b of the [product-declaration map](../features/routes/MAP.md) records the landing.

## Context

ADR 0039 rule 1 put in-model owner blobs in the `keep` class: a record that does not decode is refused, and its bytes are never rewritten. `OwnerBlob.MayOverwrite` (`dotnet/Pe.Shared.RevitData/Serialization/OwnerBlob.cs`) enforces that, `OwnerBlobStore.Write` (`dotnet/Pe.Revit/Parameters/OwnerBlobStore.cs`) calls it, and `DuctApplier` (`dotnet/Pe.Revit.Global/Lib/Mep/DuctApplier.cs`) refuses again at plan time. So one unreadable record stops every later write by its owner, until a person repairs a hidden parameter by hand. That is a lock.

The owner ruled against the lock on 2026-11-19: “no legacy no migrations, idc if its unreadable, but the error must not lock down further action. im ok with just deleting altho set aside is fine too”. Ruling 5 was put to the owner as: "an unreadable model record may be overwritten once its bytes are kept on this machine and one notice is posted". kaitpw: "agreed on all."

Two changes in this effort make unreadable records ordinary. Ruling 14 changes the key of the duct record to `UniqueId` with a version bump, so every existing duct record becomes unreadable. Rooms treats an unreadable record five different ways across its stored places.

## Decision

1. **An unreadable model record does not lock its owner.** A write may replace a record that does not decode. This covers a decode failure of the envelope and a decode failure of the owner's data, an older version included. Per the owner's 2026-11-20 ruling, “i want no extra machinery that is business logic unless its absolutely critical”, Pe refuses to replace a valid envelope from the same owner at a newer version and tells the user to update Pe. Evidence in `.artifacts/runs/product-decl-20261120/RULES.md` (Unknown-version envelope).
2. **The bytes are kept first.** Before the replacement, the raw text of the old record is written to a file on this machine. The write then posts one notice that names the document, the owner and the place of the kept bytes. The notice does not repeat on a retry.
3. **The order is the safety.** A failed backup or a failed notice keeps the old bytes in the model, and the write is refused. A plan reports that a replacement is needed. It keeps no bytes, posts no notice and changes nothing.
4. **One mechanism.** The backup and the notice are one shared path beside `OwnerBlobStore.Write`. No owner writes its own.
5. **No migration code.** The kept bytes are for a person or Pea to read. No reader decodes them again.

What does not change: authored files and secrets stay in the `keep` class of ADR 0039. The plan still seals the raw text of each record it read, and apply still refuses when that text changed (ADR 0032 storage amendment, rule 3). Old data with no envelope is still read as absent.

## Consequences

- This is ADR 0039's own pattern for a damaged journal, as [ADR 0056](0056-recover-stored-state-without-manual-file-deletion.md) states it: keep the prior bytes, set the damaged state aside, post one notice, and ask the person to delete nothing. ADR 0057 applies that pattern to a record in the model. ADR 0056 is unchanged.
- [ADR 0053](0053-the-model-store-is-a-receipt.md) limits what an overwrite can lose. The duct record supplies no design value. It holds receipts, and the rulings of ADR 0053 rule 6 (a role, a verdict, a rule table). An overwrite of an unreadable duct record loses those rulings from the model, and the kept bytes are their only copy. A receipt that is gone shows no drift, so the first read after an overwrite prices from the live parameters.
- The kept bytes are on one machine. In a shared model, a second person sees the new record and the notice text only.
- A hidden parameter may hold data from another add-in version or a Transfer Project Standards accident. The overwrite replaces it. The notice is the only signal.
- Every caller that reads before it writes is audited in S8b: AutoTag, Partition, Takeoff, Parameter Links and the bridge project-home writes.
- The fresh-rung test in `dotnet/Pe.Revit.Tests/LibraryBehavior/OwnerBlobRoundTripTests.cs` that proves the old keep policy is rewritten to prove this one: seeded unreadable bytes, a write, the bytes found on disk, one notice, and the new record read back.

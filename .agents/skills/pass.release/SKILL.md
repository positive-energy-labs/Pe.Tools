---
name: release
description: Carry a version through publication to its real consumer. Trigger on "release", "cut a release", "ship a version", "publish a release", or before any release publication. Not artifact-only packaging; that is `execute`.
argument-hint: "Which version, from which installed baseline, promising what?"
figure: Ferryman — the crossing ends on the other bank
prevents: "premature release closure: shipped bytes never made the crossing"
stop: exact published bytes reached the consumer, promised outcomes proven, failures and gaps recorded
---
# Release

**Be the Ferryman.** Departure is not arrival. The passenger boards on the old bank; a better boat waiting on the far bank cannot rescue a broken crossing.

## Laws

- Use `execute` for current commands and custody. Pin the source, dependency versions, old consumer and intended outcomes before building. Preserve unrelated work.
- Test the final distributable after every packaging transformation. Verify its identity, dependency closure and startup outside the checkout. Publish those exact bytes; rebuilding invalidates their proof.
- Drive old → new through the user's normal upgrade path. A direct install cannot prove self-update. Name a broken old caller's bootstrap recovery explicitly. Use a supported candidate path; publication needed for acceptance remains pending until that acceptance passes.
- Check each affected boundary independently: admission, handoff, installation, responsive successor, preserved data and restoration. Exercise changed background behavior and refusal paths. A spawned process, version string or installer exit is not the whole outcome. Validate the observer and isolation before trusting them.
- Read back the published asset identity and the actual answering consumer. Retain failed attempts; distinguish product failures from proof failures. Contain a broken published release through the supported withdrawal or recovery path.
- Close with `prove` stamps and `docs` receipts: versions, hashes, outcomes, warnings and remaining gaps. Retire owned proof resources. Never call publication alone done.

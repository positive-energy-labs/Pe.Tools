---
name: release
description: Carry a version through publication to its real consumer. Trigger on "release", "cut a release", "ship a version", "publish a release", or before any release publication. Not artifact-only packaging; that is `execute`.
argument-hint: "Which version, from which installed baseline, promising what?"
figure: Ferryman — the crossing ends on the other bank
prevents: "premature release closure: shipped bytes never made the crossing"
stop: exact published bytes reached the consumer, promised outcomes proven, failures and gaps recorded
---
# Release

**Be the Ferryman.** Departure is not arrival, and the passenger boards on the old bank. You may not call the crossing done when the boat leaves, and you may not pull down the old pier until the passenger stands on the far bank, because a broken crossing comes back to it.

## Laws

- Take current commands and custody rules from `execute`. Before you build, pin the source, the dependency versions, the old consumer and the intended outcomes. Preserve unrelated work.
- Test the final distributable after every packaging step. Verify its identity, its dependency closure and its startup outside the checkout. Publish those exact bytes, because a rebuild invalidates their proof.
- Drive the upgrade from old to new through the user's normal upgrade path, because a direct install cannot prove self-update. Name the bootstrap recovery for a broken old caller. Use a supported candidate path. A publication that acceptance depends on stays pending until that acceptance passes.
- Check each affected boundary on its own: admission, handoff, installation, a responsive successor, preserved data and restoration. Exercise changed background behavior and the refusal paths. A spawned process, a version string or an installer exit code is not the whole outcome. Validate the observer and its isolation before you trust them.
- Read back the published asset's identity and the consumer that actually answers. Keep failed attempts, and tell product failures apart from proof failures. Contain a broken published release through the supported withdrawal or recovery path.
- Close with `prove` stamps and `docs` receipts: versions, hashes, outcomes, warnings and remaining gaps. Publication alone is never done.

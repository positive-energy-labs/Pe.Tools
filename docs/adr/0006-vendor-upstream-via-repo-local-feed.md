# ADR 0006 — Vendor upstream packages through a committed repo-local feed

Date: 2026-08-17. Status: accepted, implemented.

## Context

Some upstream code we depend on is not published to public NuGet, or needs patching ahead of upstream.
Consuming it from a machine-local NuGet source breaks CI and fresh checkouts: restore then depends on
state that only exists on one developer's machine.

## Decision

Vendor those upstream packages as `.nupkg` files committed to a repo-local feed, registered as a NuGet
source in `nuget.config`. A fresh checkout restores with no primed package cache and no extra source
registration. Live instance: `eng/sdk-feed`, registered as `pe-revit-sdk`, currently carrying 12 package
IDs (`Pe.Revit.Sdk`, `Pe.Revit.Cli`, `Pe.Revit.Compat.R2023`–`R2026`, …) across their pinned versions.

Rejected alternatives:

- **Embedded fork.** Made this repo own upstream's startup/bootstrap behavior, and the fork package still
  only existed in a user-local feed — CI and release restore broke.
- **Full-DLL project reference.** Turns an optional integration into a hard runtime dependency; a missing
  install becomes an assembly-load crash instead of a recoverable user-facing message.
- **Raw vendored DLL with `HintPath`.** Works, but package restore is more reproducible and self-describing
  than hand-managed local assembly references.
- **Reflection-only integration.** Duplicates the lookup/shim logic upstream already packaged, pushing
  maintenance into this repo — the opposite of the goal.

## Consequences

- Fresh clones and CI restore identically; no machine-specific NuGet source, no cache priming.
- Binary artifacts live in git history, so the repo grows with every vendored version bump; prune stale
  versions deliberately rather than accumulating forever.
- Upgrading upstream is an explicit, reviewable commit (drop the new `.nupkg`, bump the version reference)
  instead of an invisible restore-time float.
- Upstream keeps lifecycle ownership; we only pin what we consume.

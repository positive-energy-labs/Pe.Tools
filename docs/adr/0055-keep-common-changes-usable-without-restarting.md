# Keep common changes usable without restarting

Date: 2026-11-13.

## Context

The owner set the bar when discussing Pod changes. “a user should not have to restart their app for most things. im ok making an exception if the capability we can offer in that tier is significant.”

## Decision

Keep common changes usable while the app is running. A capability with enough value can justify a restart.

## Consequences

When a design requires a restart, name the capability that makes that cost worthwhile. The rule also applies to changes outside Pods.

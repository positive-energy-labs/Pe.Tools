// Extracted metadata only; no old declaration or runtime is imported.
// Root ruling 2026-11-07: keep the six Takeoffs entries through Phase 1. Remove
// those entries and their links with the atlas demos in the same gated Phase 2 commit.
export const retainedFixtureCatalogue = [
  {
    "route": "takeoffs",
    "path": "/takeoffs",
    "action": "adopt",
    "title": "project-a â€” regions drawn, nothing adopted",
    "href": "/takeoffs?fixture=adopt"
  },
  {
    "route": "takeoffs",
    "path": "/takeoffs",
    "action": "partition",
    "title": "project-a â€” zones adopted, ready to partition",
    "href": "/takeoffs?fixture=partition"
  },
  {
    "route": "takeoffs",
    "path": "/takeoffs",
    "action": "refresh",
    "title": "project-a â€” a stale model waiting for a re-read",
    "href": "/takeoffs?fixture=refresh"
  },
  {
    "route": "takeoffs",
    "path": "/takeoffs",
    "action": "sync",
    "title": "project-a â€” partitioned, .r10 bound, sync unreviewed",
    "href": "/takeoffs?fixture=sync"
  },
  {
    "route": "takeoffs",
    "path": "/takeoffs",
    "action": "launch",
    "title": "project-a â€” synced, RHVAC not open",
    "href": "/takeoffs?fixture=launch"
  },
  {
    "route": "takeoffs",
    "path": "/takeoffs",
    "action": "retry-r10",
    "title": "project-a â€” the .r10 read failed",
    "href": "/takeoffs?fixture=retry-r10"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "refresh",
    "title": "the patch bay: your Revit 2025, two of Pea's, recents 2022 to 2027",
    "href": "/session-admin?fixture=refresh"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "patch-bay",
    "title": "patch-bay",
    "href": "/session-admin?fixture=patch-bay"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "controlled-hot",
    "title": "controlled-hot",
    "href": "/session-admin?fixture=controlled-hot"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "observed-icon",
    "title": "observed-icon",
    "href": "/session-admin?fixture=observed-icon"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "background-booting",
    "title": "background-booting",
    "href": "/session-admin?fixture=background-booting"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "blocked-plan",
    "title": "blocked-plan",
    "href": "/session-admin?fixture=blocked-plan"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "waiting-plan",
    "title": "waiting-plan",
    "href": "/session-admin?fixture=waiting-plan"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "receipt-handoff",
    "title": "receipt-handoff",
    "href": "/session-admin?fixture=receipt-handoff"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "update-downloading",
    "title": "update-downloading",
    "href": "/session-admin?fixture=update-downloading"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "update-failed",
    "title": "update-failed",
    "href": "/session-admin?fixture=update-failed"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "update-check-failed",
    "title": "update-check-failed",
    "href": "/session-admin?fixture=update-check-failed"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "disconnected",
    "title": "disconnected",
    "href": "/session-admin?fixture=disconnected"
  },
  {
    "route": "session-admin",
    "path": "/session-admin",
    "action": "no-revit",
    "title": "no-revit",
    "href": "/session-admin?fixture=no-revit"
  }
] as const;

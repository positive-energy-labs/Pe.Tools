import { z } from "zod";
import { defineRoute } from "./manifest";

export const settingsManifest = defineRoute({
  key: "settings",
  name: "Settings",
  docs: "This machine and this app: Revit, Update, Share, Pea providers, Host, notifications, and appearance. Each group states its critical state while folded; repair and configuration live in the group.",
});

export const savedTakeoffsManifest = defineRoute({
  key: "takeoffs-saved",
  name: "Takeoffs saved review",
  docs: "Review an explicit saved takeoff capture. The capture retains its original document and provenance; switching to live chooses a new source.",
  page: z.object({ work: z.string().optional() }),
  readings: {
    capture: (page: { work?: string }) =>
      page.work ? { kind: "takeoff-saved" as const, id: page.work } : null,
    captures: { kind: "takeoff-saved" },
  },
});

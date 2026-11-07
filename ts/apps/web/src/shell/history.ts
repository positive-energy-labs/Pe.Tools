import {
  historyPointSchema,
  recordedWorkSchema,
  workKey,
  type HistoryPoint,
  type HistoryPose,
} from "@pe/agent-contracts";
import { z } from "zod";
import { hostFetch } from "../host/runtime.ts";
import type { WorkJournalDoor } from "@pe/agent-contracts";

export const historySnapshotSchema = z.object({
  point: historyPointSchema,
  work: z.array(recordedWorkSchema),
});
export type HistorySnapshot = z.infer<typeof historySnapshotSchema>;
export const historyRequest = async (query: string, body?: unknown) => {
  const response = await hostFetch(
    `/pe/history${query}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok) throw Error(value?.error?.message ?? "History unavailable");
  return value;
};
export const currentHistoryPoint = () =>
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("at");
export const recordingView = () =>
  currentHistoryPoint() !== null &&
  new URLSearchParams(window.location.search).get("compare") !== "now";
export const publicationPose = (
  instance: string,
  route: string,
  page: Readonly<Record<string, unknown>>,
): HistoryPose => ({
  instance,
  route,
  page: { ...page },
  href: `${window.location.pathname}${window.location.search}`,
});

/** A snapshot owns all Work inputs for this mount. No current feed or journal is acquired. */
export function recordedWorkDoor(snapshot: HistorySnapshot): WorkJournalDoor {
  const refuse = () => {
    throw Error("needs live Revit");
  };
  return {
    lifetime: "subscription",
    accepted: refuse,
    submit: refuse,
    submitWork: refuse,
    receipts() {
      return {
        subscribe(deliver) {
          deliver({ kind: "ready", receipts: { rows: [], from: 0 as never, through: 0 as never } });
          return () => {};
        },
      };
    },
    open(scope) {
      return {
        subscribe(deliver) {
          const work = snapshot.work.find((w) => workKey(w.handle.key) === workKey(scope.key));
          if (!work)
            deliver({
              kind: "failed",
              failure: {
                kind: "failed",
                code: "history.unavailable",
                message: "Work was not published at this point",
              },
            });
          else
            deliver({
              kind: "ready",
              snapshot: { handle: work.handle, revision: work.revision, value: work.doc },
              history: { acks: [], from: work.revision + 1 },
            });
          return () => {};
        },
      };
    },
  };
}

export function pointHref(point: HistoryPoint, instance: string) {
  const pose = point.history.poses.find((p) => p.instance === instance);
  if (!pose) throw Error("This route was never published at this point");
  const url = new URL(pose.href, window.location.origin);
  url.searchParams.set("at", point.id);
  url.searchParams.set("atInstance", instance);
  url.searchParams.delete("compare");
  url.searchParams.delete("fixture");
  return `${url.pathname}${url.search}`;
}

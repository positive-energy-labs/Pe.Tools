import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import type { CommandReads } from "./command-executor.ts";
import type { RevitBridge } from "./bridge.ts";
import type { FamilyActionDependencies } from "./family-actions.ts";
import { assertFresh, documentMarks } from "./document-marks.ts";
import { readOriginalProcess, readNativeReceipt } from "./native-receipts.ts";
import { readMember } from "./settings.ts";
import { captureDirectory, listPackages } from "./packages.ts";
import { readMachineSession } from "./machine.ts";
import { actionWorkspace } from "./takeoff-actions.ts";
import { CANCEL_OPERATION_KEY } from "./bridge.ts";
import { onePackage } from "./packages.ts";
import { join } from "node:path";

/** Current resource facts only. ActionJournal owns comparisons and every async fence. */
export function commandReads(
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies,
): CommandReads {
  return {
    work: deps.workspace ?? actionWorkspace(),
    recover(step) {
      if (!step.process) throw Error("No exact native process was captured for this step");
      return readNativeReceipt(step, step.process, deps.sdk);
    },
    async effectPath(effect) {
      const listing = await listPackages(deps.podsRoot);
      if (listing.unreadable.length)
        throw Error("Cannot resolve member effects against an unreadable Pod catalog");
      if (!listing.packages.some((pod) => pod.id === effect.pod)) return undefined;
      return join(onePackage(listing, effect.pod).directory, effect.path);
    },
    async target(target, needs) {
      if (target.kind !== "document" && target.kind !== "session") return;
      const selected = (await Effect.runPromise(bridge.list)).find(
        (row) =>
          row.sessionId === (target.kind === "document" ? target.ref.session : target.session),
      );
      if (!selected) throw Error("Original session is unavailable");
      if (target.kind === "session") return;
      const document = selected.state?.openDocuments.find(
        (doc) => doc.openId === target.ref.openId,
      );
      if (
        !document ||
        (needs === "project-document" && document.isFamilyDocument) ||
        (needs === "family-document" && !document.isFamilyDocument)
      )
        throw Error("Target document lifetime or kind differs from the command contract");
    },
    async cancel(requestId) {
      const answer = await Effect.runPromise(bridge.invoke(CANCEL_OPERATION_KEY, { requestId }));
      const result = answer.value as { cancelled?: boolean; message?: string } | null;
      if (result?.cancelled === false)
        throw Error(result.message ?? "Native request is not running");
      return result;
    },
    async read(dependency) {
      switch (dependency.kind) {
        case "member":
          return (
            deps.runPods ??
            ((effect) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer))))
          )(
            readMember({ pod: dependency.pod, path: dependency.path }, { podsRoot: deps.podsRoot }),
          ).then(
            (value) => value.sha256,
            (error: { statusCode?: number }) => {
              if (error.statusCode === 404) return null;
              throw error;
            },
          );
        case "document-mark":
          assertFresh(documentMarks(bridge), dependency.ref, dependency.takenAt);
          return true;
        case "incarnation": {
          const actual = await readOriginalProcess(
            dependency.process.pid,
            Date.parse(dependency.process.processStartUtc),
            deps.sdk,
          );
          const target = dependency.target;
          if (target.kind === "document" || target.kind === "session") {
            const session = (await Effect.runPromise(bridge.list)).find(
              (row) =>
                row.sessionId ===
                (target.kind === "document" ? target.ref.session : target.session),
            );
            if (
              !session ||
              session.processId !== actual.pid ||
              session.processStartUtcUnixMs !== Date.parse(actual.processStartUtc) ||
              (target.kind === "document" &&
                !session.state?.openDocuments.some((doc) => doc.openId === target.ref.openId))
            )
              throw Error(
                "Original process incarnation or document lifetime is no longer available",
              );
          }
          return actual;
        }
        case "census": {
          if (dependency.process) {
            const session = await readMachineSession(dependency.process);
            if (!session.documents) throw Error("SDK document census unavailable");
            return session.documents.map((doc) => doc.openId).sort();
          }
          const session = (await Effect.runPromise(bridge.list)).find(
            (row) => row.sessionId === dependency.session,
          );
          if (!session?.state) throw Error("Document census unavailable");
          return session.state.openDocuments.map((doc) => doc.openId).sort();
        }
        case "directory":
          return captureDirectory(dependency.path);
        case "catalog": {
          const listing = await listPackages(deps.podsRoot);
          if (listing.unreadable.length)
            throw Error("Cannot verify an unreadable Pod dependency catalog");
          return listing.packages
            .map((pod) => ({
              id: pod.id,
              members: pod.members.map((member) => ({ path: member.path, sha256: member.sha256 })),
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
        }
      }
    },
  };
}

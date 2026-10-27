import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import type { CommandResources } from "./command-executor.ts";
import type { RevitBridge } from "./bridge.ts";
import type { FamilyActionDependencies } from "./family-actions.ts";
import { assertFresh, documentMarks } from "./document-marks.ts";
import { readOriginalProcess } from "./native-receipts.ts";
import { readMember } from "./settings.ts";
import { captureDirectory, listPackages } from "./packages.ts";
import { readMachineSession } from "./machine.ts";
import { onePackage } from "./packages.ts";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ActionReceipt } from "@pe/agent-contracts";
import { readBootstrapIdle, readBootstrapInstallation } from "./bootstrap.ts";

/** Current resource facts only. ActionJournal owns comparisons and every async fence. */
export function commandResources(
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies,
  readReceipt: (id: string) => Promise<ActionReceipt | undefined>,
): CommandResources {
  return {
    work: deps.workspace,
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
    async probe(dependency) {
      switch (dependency.kind) {
        case "receipt": {
          const current = await readReceipt(dependency.probe.id);
          return !!current && current.key === dependency.probe.key && current.state === "succeeded";
        }
        case "capture":
          return createHash("sha256")
            .update(Buffer.from(dependency.probe.bytesBase64, "base64"))
            .digest("hex");
        case "file":
          return readFile(dependency.probe.path).then(
            (bytes) => createHash("sha256").update(bytes).digest("hex"),
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            },
          );
        case "sdk-installation":
          return readBootstrapInstallation(dependency.probe.year, deps.sdk);
        case "sdk-idle":
          return readBootstrapIdle(deps.sdk);
        case "member":
          return (
            deps.runPods ??
            ((effect) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer))))
          )(
            readMember(
              { pod: dependency.probe.pod, path: dependency.probe.path },
              { podsRoot: deps.podsRoot },
            ),
          ).then(
            (value) => value.sha256,
            (error: { statusCode?: number }) => {
              if (error.statusCode === 404) return null;
              throw error;
            },
          );
        case "document-mark":
          assertFresh(documentMarks(bridge), dependency.probe.ref, dependency.probe.takenAt);
          return true;
        case "incarnation": {
          const actual = await readOriginalProcess(
            dependency.probe.process.pid,
            Date.parse(dependency.probe.process.processStartUtc),
            deps.sdk,
          );
          const target = dependency.probe.target;
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
          return true;
        }
        case "census": {
          if (dependency.probe.process) {
            const session = await readMachineSession(dependency.probe.process);
            if (!session.documents) throw Error("SDK document census unavailable");
            return session.documents.map((doc) => doc.openId).sort();
          }
          const session = (await Effect.runPromise(bridge.list)).find(
            (row) => row.sessionId === dependency.probe.session,
          );
          if (!session?.state) throw Error("Document census unavailable");
          return session.state.openDocuments.map((doc) => doc.openId).sort();
        }
        case "directory":
          return directorySnapshot(await captureDirectory(dependency.probe.path));
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

/** Directory freshness is membership/content/diagnostics, not duplicated file payload bytes. */
export const directorySnapshot = (captured: Awaited<ReturnType<typeof captureDirectory>>) => ({
  members: captured.members.map(({ path, sha256 }) => ({ path, sha256 })),
  diagnostics: captured.diagnostics,
});

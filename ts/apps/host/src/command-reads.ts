import { get } from "./action-blobs.ts";
import { SdkSession } from "./sdk-session.ts";
import { Effect } from "effect";
import type { CommandResources } from "./command-executor.ts";
import type { RevitBridge } from "./bridge.ts";
import { runPods, type FamilyActionDependencies } from "./family-actions.ts";
import { assertFresh, assertSealed } from "./document-marks.ts";
import { readOriginalProcess } from "./native-receipts.ts";
import { readMember, readMemberPod } from "./settings.ts";
import { captureDirectory, listPackages } from "./packages.ts";
import { readMachineSession } from "./machine.ts";
import { onePackage, type AdmittedPackage } from "./packages.ts";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ActionReceipt } from "@pe/agent-contracts";
import { readBootstrapIdle, readBootstrapInstallation } from "./bootstrap.ts";
import type { HostNativeRead } from "@pe/host-internal/native-read";
import type { RequestIdentityData, NativeAnswer } from "@pe/host-internal/request-contracts";
import type { OpResponseOf } from "@pe/host-contracts/operation-types";
import { RequestIdentity } from "./request-services.ts";
import { InvalidRead, type NativeReads } from "./native-reads.ts";
import { isDoorFailure } from "./http-problems.ts";
import { createReadOwnership, type ReadOwner } from "./reads/read-ownership.ts";

export type NativeReadTerminals = Pick<NativeReads["Service"], "state" | "settle"> | { readonly kind: "recorded" };

/** The command's Promise boundary owns read leases; NativeReads owns native terminal evidence. */
export function commandReadOwnership(
  native: HostNativeRead["Service"] | undefined,
  terminals: NativeReadTerminals | undefined,
) {
  if (native && !terminals) throw Error("Native read service requires terminal observation");
  const live = terminals && !("kind" in terminals) ? terminals : undefined;
  const owners = new WeakMap<RequestIdentityData, ReadOwner>();
  const lifetime = createReadOwnership({
    native: async (identity, key, input, signal) => {
      if (!native) throw Error("Native read service is unavailable");
      // Cancellation detaches this read lease, never native cleanup.
      // effect-edge: island, phase 5
      const result = await Effect.runPromise(native.read({ key, input, scope: identity.scope }).pipe(
        Effect.provideService(RequestIdentity, identity), Effect.result,
      ), { signal });
      if (result._tag === "Failure") throw result.failure;
      return result.success as NativeAnswer<OpResponseOf<typeof key>>;
    },
    // No NativeReads exists on a recording lane: it dispatched no native work to clean up.
    state: (identity) => live?.state(identity) ?? { kind: "settled", requiredDescendants: [], evidence: [] },
    settle: async (identity) => live
      // effect-edge: island, phase 5
      ? Effect.runPromise(live.settle(identity))
      : { kind: "settled", requiredDescendants: [], evidence: [] },
  });
  const readOwnership = {
    ...lifetime,
    open(identity: RequestIdentityData) {
      const owner = lifetime.open(identity);
      owners.set(identity, owner);
      return owner;
    },
  };
  const nativeRead: HostNativeRead["Service"] | undefined = native && {
    resolve: native.resolve,
    read: (request) => Effect.gen(function* () {
      const identity = yield* RequestIdentity;
      const owner = owners.get(identity);
      if (!owner) return yield* native.read(request);
      // ReadOwner's port admits again under the captured scope, never the supplied target.
      const readOwned = owner.native as (key: string, input: unknown) => Promise<NativeAnswer<unknown>>;
      return (yield* Effect.tryPromise({
        try: () => readOwned(request.key, request.input),
        catch: (error) => isDoorFailure(error) ? error
          : new InvalidRead({ message: String(error), status: 503, problem: "read.owner" }),
      })) as NativeAnswer<import("effect").Schema.Json>;
    }),
  };
  return { readOwnership, nativeRead };
}

/** One gate pass's Pod reads, by Pod id; a pass is garbage once its gate returns. */
const podReads = new WeakMap<object, Map<string, Promise<AdmittedPackage>>>();

/** Current resource facts only. ActionJournal owns comparisons and every async fence. */
export function commandResources(
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies,
  readReceipt: (id: string) => Promise<ActionReceipt | undefined>,
): CommandResources {
  return {
    work: deps.workspace,
    workReads: deps.workReads,
    async effectPath(effect) {
      const listing = await listPackages(deps.podsRoot);
      if (listing.unreadable.length)
        throw Error("Cannot resolve member effects against an unreadable Pod catalog");
      if (!listing.packages.some((pod) => pod.id === effect.pod)) return undefined;
      return join(onePackage(listing, effect.pod).directory, effect.path);
    },
    async target(target, needs) {
      if (target.kind !== "document" && target.kind !== "session") return;
      const session = target.kind === "document" ? target.ref.session : target.session;
      const selected = await runPods(deps, SdkSession.resolve(bridge, { session }));
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
    async probe(dependency, moment, pass) {
      switch (dependency.kind) {
        case "receipt": {
          const current = await readReceipt(dependency.probe.id);
          return !!current && current.key === dependency.probe.key && current.state === "succeeded";
        }
        case "capture":
          return createHash("sha256")
            .update(await get(dependency.probe.blob))
            .digest("hex");
        case "file":
          // Bytes retained at admission are the input (cdb265c9): the path is not read again, so an
          // edit to it after admission changes nothing. A file with no retained bytes is still re-read.
          if (dependency.blob)
            return createHash("sha256")
              .update(await get(dependency.blob))
              .digest("hex");
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
        case "member": {
          // One gate pass reads a Pod once, and reads only that Pod's folder (D22). A gate runs at
          // every async boundary, and a member read was a discovery of every Pod in the home: per
          // member, 34 scripts in a 35-Pod home cost 115 s a gate, and per pass still 3.4 s. Each
          // pass still reads the disk afresh, and a probe outside a pass shares nothing.
          const ctx = { podsRoot: deps.podsRoot };
          let pods = pass && podReads.get(pass);
          if (pass && !pods) podReads.set(pass, (pods = new Map()));
          let pod = pods?.get(dependency.probe.pod);
          if (!pod) {
            pod = runPods(deps, readMemberPod(dependency.probe.pod, ctx, true));
            pods?.set(dependency.probe.pod, pod);
          }
          return pod.then((admitted) => runPods(deps, readMember(dependency.probe, ctx, admitted))).then(
            (value) => value.sha256,
            (error: { statusCode?: number }) => {
              if (error.statusCode === 404) return null;
              throw error;
            },
          );
        }
        case "document-mark":
          if ("sealed" in dependency.probe)
            await assertSealed(deps.marks!, dependency.probe.ref, dependency.probe.sealed);
          else assertFresh(deps.marks!, dependency.probe.ref, dependency.probe.takenAt);
          return true;
        case "incarnation": {
          // One gate runs at every async boundary of an action (about nine for a script), and the SDK
          // reading is a `pe-revit session list --all` spawn each: ~0.5 s on a clean machine, seconds on
          // one with many session rows. The SDK proves the incarnation at the first gate and at the last
          // one before dispatch; between them the bridge attachment below, which carries the same pid and
          // start and must still be connected, is the proof. A missing moment is the strongest reading.
          const sdkProof = moment === undefined || moment === "admit" || moment === "dispatch";
          const actual = sdkProof
            ? await readOriginalProcess(
                dependency.probe.process.pid,
                Date.parse(dependency.probe.process.processStartUtc),
                deps.sdk,
              )
            : dependency.probe.process;
          const target = dependency.probe.target;
          if (target.kind === "document" || target.kind === "session") {
            const id = target.kind === "document" ? target.ref.session : target.session;
            const session = await runPods(deps, SdkSession.resolve(bridge, { session: id }));
            if (
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
          const session = await runPods(deps,
            SdkSession.resolve(bridge, { session: dependency.probe.session }),
          );
          if (!session.state) throw Error("Document census unavailable");
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

import { Schema } from "effect";
import { tsOnlyOperationSchemas } from "@pe/host-contracts/operation-types";
import { listPods, resolvePodIdentity, listRuns, readMember, composeMember } from "./settings.ts";
import { runPods } from "./family-actions.ts";

// This closed table owns bridge-free reads, not public operation dispatch. In particular,
// composeMember receives no bridge callback here, so its public SessionWrite cannot enter.
const operations = {
  "pod.list": (raw: unknown) => {
    const input = Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.list"].request)(raw);
    return input.projection === "identity"
      ? runPods({}, resolvePodIdentity(input.folder))
      : runPods({}, listPods());
  },
  "pod.member.read": (raw: unknown) =>
    runPods(
      {},
      readMember(Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.member.read"].request)(raw)),
    ),
  "pod.member.compose": (raw: unknown) =>
    runPods(
      {},
      composeMember(
        Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.member.compose"].request)(raw),
      ),
    ),
  "pod.runs": (raw: unknown) =>
    runPods(
      {},
      listRuns(Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.runs"].request)(raw)),
    ),
} satisfies Record<LocalReadKey, (raw: unknown) => Promise<unknown>>;
import type { LocalReadKey } from "@pe/host-internal/reads/local";
export async function readLocal(key: string, args: unknown): Promise<unknown> {
  if (!Object.hasOwn(operations, key)) throw Error(`Unknown local input ${key}`);
  return operations[key as LocalReadKey](args);
}

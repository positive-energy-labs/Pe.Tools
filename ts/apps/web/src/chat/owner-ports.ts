/** Browser composition ports; the host imports only graph/kernel declarations. */
import { threadWorkSnapshotSchema, type Reading } from "@pe/agent-contracts";
import type { AdmittedMount } from "../shell/admitted-mount";
import type {
  PagePort,
  FieldControls,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { subscriptionSource } from "../shell/readings-use";
import { chatData, chatSchemas } from "./graph.ts";
export type ChatHandle = Omit<AdmittedMount, "page" | "controls"> & {
  readonly fixture: boolean;
  page: PagePort<typeof chatData, typeof chatSchemas>;
  controls: FieldControls<typeof chatData, typeof chatSchemas>;
};
export function chatSources() {
  return {
    transcript: subscriptionSource({
      request: (ctx) => ({ kind: "thread", thread: String(ctx.args || "draft") }),
      decode: (v) => v,
    }),
    head: subscriptionSource({
      request: (ctx) => ({ kind: "thread-head", thread: String(ctx.args || "draft") }),
      decode: (v) => v,
    }),
    threads: subscriptionSource({ request: () => ({ kind: "threads" }), decode: (v) => v }),
    threadWork: subscriptionSource({
      request: () => ({ kind: "thread-work" }),
      decode: (v) => threadWorkSnapshotSchema.parse(v),
    }),
    ...Object.fromEntries(
      (["machine", "receipts", "capabilities"] as const).map((kind) => [
        kind,
        subscriptionSource({ request: () => ({ kind }), decode: (v) => v }),
      ]),
    ),
  };
}
export function chatReading<T = unknown>(
  owner: Pick<AdmittedMount, "readingStatus">,
  id: string,
): Reading<T> {
  const { snapshot, previous } = owner.readingStatus(id);
  const value = (snapshot.value ?? previous) as T | undefined;
  if (snapshot.status === "failed")
    return {
      state: "failed",
      message: snapshot.reason,
      ...(value === undefined ? {} : { previous: value }),
    };
  if (value !== undefined)
    return snapshot.current
      ? { state: "ready", observation: value }
      : { state: "stale", previous: value, reason: "dirtied" };
  return { state: "loading", requestId: `chat.${id}`, deadline: Infinity };
}
export const chatOutcome = (owner: Pick<AdmittedMount, "timeline">, id: string) =>
  owner
    .timeline()
    .filter((row) => row.verb === id)
    .flatMap((row) => ("outcome" in row && row.outcome ? [row.outcome] : []))
    .at(-1);
/** Await the owner's press, without keeping another result or pending store in the composer. */
export async function runChatCommand(
  owner: Pick<AdmittedMount, "invoke" | "subscribe" | "timeline">,
  id: "send" | "stop" | "fork",
  input: unknown = {},
): Promise<string | null> {
  try {
    const press = owner.invoke(id, input) as { kind: "local"; press: string };
    return await new Promise((resolve) => {
      const read = () => {
        const result = owner
          .timeline()
          .flatMap((row) => ("outcome" in row && row.outcome ? [row.outcome] : []))
          .find((row) => row.id === press.press);
        if (!result || result.state === "running" || result.state === "queued") return;
        release();
        resolve(result.state === "succeeded" ? null : (result.reason ?? result.state));
      };
      const release = owner.subscribe(read);
      read();
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

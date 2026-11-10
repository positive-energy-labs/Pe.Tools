import { canonicalRouteInput } from "@pe/agent-contracts";
import type { DeriveSource, PortSession, ReadingContext, ReadingDelivery, ReadingSource, WorkerChannel } from "./source-contract";
type Release = () => void;

/** One source-open: release before a port's answer; rejection fails; a leased (graph) worker is never stopped here. */
export function openSource<T>(
  source: Exclude<ReadingSource<T>, DeriveSource<T>>,
  context: ReadingContext,
  deliver: ReadingDelivery<T>,
  keep: (release: void | Release) => void,
  worker?: WorkerChannel<T>,
): void {
  const fail = (error: unknown) => deliver({ kind: "failure", error });
  if (source.kind === "worker") {
    const channel = worker ?? source.connect();
    if (!worker) keep(() => channel.stop());
    return channel.update(context, deliver);
  }
  if (source.kind === "port") {
    const accept = (session: PortSession<T>) => {
      keep(() => session.close());
      deliver({ kind: "complete", value: session.value, revision: 0 });
    };
    const opened = source.open(context);
    return opened instanceof Promise ? void opened.then(accept, fail) : accept(opened);
  }
  const opened = source.open(context, deliver);
  if (opened instanceof Promise) void opened.then(keep, fail);
  else keep(opened);
}

/** ponytail: 53-bit cyrb53 over canonical JSON, sync and cheap; full-body cost on large values
 * that declare no sourceVersion. Swap for SubtleCrypto SHA-256 if snapshots cross a trust line. */
export function contentHash(value: unknown): string | undefined {
  let text: string;
  try {
    text = canonicalRouteInput(value);
  } catch (error) { console.warn("ts/apps/web/src/shell/source-open.ts: fallback after failure", error);
    return undefined;
  }
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

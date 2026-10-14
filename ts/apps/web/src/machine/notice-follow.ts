/**
 * A web surface's follow of the host's `notices` Reading: each item arrives once, in log order, from
 * the cursor the caller keeps. A dropped stream reopens after the last id seen, so a reconnect neither
 * repeats nor skips; a `gap` (no cursor yet, or a log that no longer holds it) moves the cursor to the
 * log's current id and owes nothing. The `{ tray }` snapshot says whether the tray follows too.
 */
import { machineNoticeSchema } from "@pe/host-contracts/native-adapter";
import type { MachineNotice, ReadingFrame } from "@pe/agent-contracts";

import { openEventSource } from "#/readings";
import { readingsUrl, type OpenEvents } from "#/workbench/provider/harness-client";

export function followNotices(options: {
  origin: string;
  /** The last log id this surface handled; null on first follow. */
  cursor: number | null;
  onNotice: (notice: MachineNotice) => void;
  /** Called after each item or gap with the id to keep as the cursor. */
  onCursor: (id: number) => void;
  onTray: (present: boolean) => void;
  open?: OpenEvents;
  retryMs?: number;
}): () => void {
  const { origin, onNotice, onCursor, onTray, retryMs = 1_000 } = options;
  const open = options.open ?? openEventSource;
  let cursor = options.cursor;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: ReturnType<OpenEvents> | undefined;
  const connect = () => {
    const events = open(
      readingsUrl(origin, { kind: "notices" }, cursor === null ? undefined : cursor),
    );
    source = events;
    events.onmessage = (message: MessageEvent<string>) => {
      const frame = JSON.parse(message.data) as ReadingFrame;
      if (frame.kind === "snapshot") {
        const value = frame.value as { tray?: unknown } | null;
        if (typeof value?.tray === "boolean") onTray(value.tray);
        return;
      }
      if (frame.kind === "gap" && frame.id !== undefined) {
        cursor = frame.id;
        onCursor(frame.id);
      } else if (frame.kind === "event" && frame.id !== undefined) {
        // Never behind the cursor: a stale or repeated frame is not an item.
        if (cursor !== null && frame.id <= cursor) return;
        const notice = machineNoticeSchema.safeParse(frame.value);
        cursor = frame.id;
        if (notice.success) onNotice(notice.data);
        onCursor(frame.id);
      }
    };
    events.onerror = () => {
      events.close();
      if (!stopped) timer = setTimeout(connect, retryMs);
    };
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}

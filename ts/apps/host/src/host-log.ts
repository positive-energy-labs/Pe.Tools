import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HOST_LOG_MAX_ENTRY_BYTES, type HostEvent, type HostLogEntry } from "@pe/agent-contracts";

/** 8 segments of 8 MiB: the newest ~64 MiB of host history replays; older reads as a gap. */
export const HOST_LOG_LIMITS = {
  segmentBytes: 8 * 1024 * 1024,
  segments: 8,
  entryBytes: HOST_LOG_MAX_ENTRY_BYTES,
};

/** A segment is named by the first id it was opened for, so the floor survives an emptied file. */
const segmentName = (first: number) => `${String(first).padStart(16, "0")}.jsonl`;

function oversize(event: HostEvent, bytes: number): HostEvent {
  if (event.kind === "thread")
    return {
      kind: "oversize",
      of: "thread",
      ref: { thread: event.thread, seq: event.event.seq },
      bytes,
    };
  if (event.kind === "receipt")
    return {
      kind: "oversize",
      of: "receipt",
      ref: { id: event.receipt.id, revision: event.receipt.revision },
      bytes,
    };
  return event;
}

/**
 * The host log (`HostLogEntry` in `@pe/agent-contracts`): append-only JSONL segments, one writer.
 * Appends and subscriber delivery are synchronous, so every subscriber sees id order.
 */
export class HostLog {
  private readonly segments: { first: number; bytes: number }[];
  private lastId = 0;
  private readonly listeners = new Set<(entry: HostLogEntry) => void>();

  constructor(
    private readonly dir: string,
    private readonly limits = HOST_LOG_LIMITS,
  ) {
    mkdirSync(dir, { recursive: true });
    this.segments = readdirSync(dir)
      .filter((name) => /^\d{16}\.jsonl$/.test(name))
      .map((name) => ({ first: Number(name.slice(0, 16)), bytes: statSync(join(dir, name)).size }))
      .sort((a, b) => a.first - b.first);
    const tail = this.segments.at(-1);
    if (!tail) return;
    this.lastId = this.entries(tail.first).at(-1)?.id ?? tail.first - 1;
    // A crash can leave a torn last line; the next append must start a line of its own.
    const file = join(dir, segmentName(tail.first));
    if (tail.bytes && !readFileSync(file, "utf8").endsWith("\n")) appendFileSync(file, "\n");
  }

  /** The last id appended; a reader that applied it is current. */
  get last() {
    return this.lastId;
  }
  /** The lowest id retention still keeps. */
  get floor() {
    return this.segments[0]?.first ?? this.lastId + 1;
  }

  append(event: HostEvent): HostLogEntry {
    const id = this.lastId + 1;
    const at = new Date().toISOString();
    let entry: HostLogEntry = { id, at, event };
    let line = JSON.stringify(entry);
    const bytes = Buffer.byteLength(line);
    if (bytes > this.limits.entryBytes) {
      entry = { id, at, event: oversize(event, bytes) };
      line = JSON.stringify(entry);
    }
    let tail = this.segments.at(-1);
    if (!tail || tail.bytes >= this.limits.segmentBytes) tail = this.open(id);
    appendFileSync(join(this.dir, segmentName(tail.first)), `${line}\n`);
    tail.bytes += Buffer.byteLength(line) + 1;
    this.lastId = id;
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (error) {
        console.error("Host log subscriber failed", error);
      }
    }
    return entry;
  }

  /** Entries after `after`, oldest first. `gap` says retention already dropped some of them. */
  read(after: number, match?: (entry: HostLogEntry) => boolean) {
    const entries: HostLogEntry[] = [];
    this.segments.forEach((segment, i) => {
      if ((this.segments[i + 1]?.first ?? Infinity) - 1 <= after) return;
      for (const entry of this.entries(segment.first))
        if (entry.id > after && (!match || match(entry))) entries.push(entry);
    });
    return { gap: after < this.floor - 1, entries };
  }

  subscribe(listener: (entry: HostLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Rewrite every segment without the matching entries (a deleted thread leaves no text behind). */
  forget(match: (entry: HostLogEntry) => boolean) {
    // A fresh tail named past the last id keeps that id when every kept entry is gone.
    this.open(this.lastId + 1);
    for (const segment of this.segments) {
      const file = join(this.dir, segmentName(segment.first));
      const kept = this.entries(segment.first).filter((entry) => !match(entry));
      const text = kept.map((entry) => `${JSON.stringify(entry)}\n`).join("");
      writeFileSync(`${file}.tmp`, text);
      renameSync(`${file}.tmp`, file);
      segment.bytes = Buffer.byteLength(text);
    }
  }

  private open(first: number) {
    const segment = { first, bytes: 0 };
    if (this.segments.at(-1)?.first !== first) this.segments.push(segment);
    writeFileSync(join(this.dir, segmentName(first)), "", { flag: "a" });
    while (this.segments.length > this.limits.segments)
      rmSync(join(this.dir, segmentName(this.segments.shift()!.first)), { force: true });
    return this.segments.at(-1)!;
  }

  private entries(first: number): HostLogEntry[] {
    const file = join(this.dir, segmentName(first));
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line) => {
        if (!line) return [];
        try {
          return [JSON.parse(line) as HostLogEntry];
        } catch {
          return []; // a torn last line from a crash
        }
      });
  }
}

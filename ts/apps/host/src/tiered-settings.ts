import { readSettingTiers, readTier } from "@pe/host-internal/settings-files";
import { settingOwners } from "@pe/mcps/product-contracts";
/**
 * Tiered settings (ADR 0037 rule 8; homes MAP slice 6b): `Settings/<owner>.json` in the user home,
 * the target model's project home and the firm home. A read returns every tier's file as it stands
 * with the home it came from, so a sheet can say which tier served a value. A write goes through
 * the one home write door (`writeHome`: compare-and-swap, prior bytes kept) and posts one notice
 * that names the file, the writer and the receipt.
 */
import { existsSync, readFileSync, watch } from "node:fs";
import { userInfo } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import type { Caller, HomeWriteRow, SettingTier } from "@pe/agent-contracts";
import { homeWriteRowSchema, callerSchema, sameAddress } from "@pe/agent-contracts";
import { z } from "zod";
import { projectHome, homes } from "@pe/host-contracts/product-paths";
import { productPathNames } from "@pe/host-contracts/contracts";
import { note, sha256Hex } from "@pe/host-contracts/kinds";
import { SETTING_WRITE_PLACE } from "./notice-feed.ts";
import { firmOwner } from "@pe/host-internal/read-graph";
import {
  appendLine,
  homeKind,
  readLines,
  rested,
  stateLog,
  writeHome,
  type HomeWrite,
} from "@pe/host-contracts/kinds";
import { hostState } from "./host-ownership.ts";
import { registerTimelineSource } from "./reads/work-timeline.ts";

const homeUndoSchema = z.strictObject({
  kind: z.literal("home-undo"),
  path: z.string(),
  sha256: z.string(),
  by: callerSchema,
  at: z.string(),
});

export const homeWritesKind = stateLog({
  schema: z.union([homeWriteRowSchema, homeUndoSchema]),
  segments: () => ["home-writes.jsonl"],
  place: () => "Home writes",
});
const tierFileKind = homeKind({
  schema: z.unknown(),
  segments: (owner: string) => [
    productPathNames.homeSettingsDirectoryName,
    `${firmOwner.parse(owner)}.json`,
  ],
  place: (owner) => `${owner} settings`,
});

export interface HomeWriteSource {
  rows(filter: { owner: string; homes: readonly string[] }): HomeWriteRow[];
  step(ref: { home: string; sha256: string }, by: Caller): HomeWrite;
}
const events = () => {
  const read = readLines(homeWritesKind.in(hostState()));
  if (read.kind === "ok" && read.skipped)
    throw Error("The home-write log has unreadable rows. Undo is unavailable; files are kept.");
  return read.kind === "ok" ? read.values : [];
};
const activeWrites = (log = events()) => {
  const active: HomeWriteRow[] = [];
  for (const event of log) {
    if (event.kind === "home-write") active.push(event);
    else {
      const index = active.findLastIndex(
        (row) => row.path === event.path && row.sha256 === event.sha256,
      );
      if (index >= 0) active.splice(index, 1);
    }
  }
  // A crash can land the restore before its completion record. The actual prior bytes consume
  // that save and the later saves of this file, including after an older undo lands next.
  const restored = new Set<HomeWriteRow>();
  const writes = log.filter((row): row is HomeWriteRow => row.kind === "home-write");
  for (const path of new Set(writes.map((row) => row.path))) {
    let hash: string;
    try {
      hash = sha256Hex(readFileSync(path));
    } catch {
      continue;
    }
    let afterRestore = false;
    for (const row of writes.filter((row) => row.path === path)) {
      if (row.priorSha256 === hash && row.sha256 !== hash) afterRestore = true;
      if (afterRestore) restored.add(row);
    }
  }
  return active.filter((row) => !restored.has(row));
};
const undoRefusal = (row: HomeWriteRow): string | null => {
  if (row.priorSha256 === null)
    return "This file was new. Undo of a first home write is not supported; the file is kept.";
  if (rested(hostState(), row.priorSha256).kind !== "ok")
    return "The prior bytes are unavailable or damaged. The file is kept.";
  try {
    return sha256Hex(readFileSync(row.path)) === row.sha256
      ? null
      : `${row.path} changed since the save. Nothing was written.`;
  } catch {
    return `${row.path} cannot be read. The file is kept.`;
  }
};
export const homeWriteSource: HomeWriteSource = {
  rows: ({ owner, homes }) =>
    events().filter(
      (row): row is HomeWriteRow =>
        row.kind === "home-write" && row.owner === owner && homes.includes(row.home),
    ),
  step(ref, by) {
    // StepRef.home identifies the file, as C2's second-source door requires, not just its root.
    const row = activeWrites().findLast(
      (row) => row.path === ref.home && row.sha256 === ref.sha256,
    );
    if (!row) throw Error("This home write is no longer available to undo. Re-read the Timeline.");
    if (by.kind !== row.by.kind || (by.kind !== "human" && by.kind !== "pea"))
      throw Error("Only the save's author can undo it.");
    const refusal = undoRefusal(row);
    if (refusal) throw Error(refusal);
    const file = tierFileKind.in(hostState().home({ root: row.home, tier: row.tier }), row.owner);
    if (file.path !== row.path)
      throw Error("The home write path does not match its owner. The file is kept.");
    const prior = row.priorSha256 === null ? null : rested(hostState(), row.priorSha256);
    if (prior?.kind !== "ok")
      throw Error("The prior bytes are unavailable or damaged. The file is kept.");
    const wrote = writeHome(file, prior.bytes, row.sha256);
    if (wrote.ok) {
      appendLine(homeWritesKind.in(hostState()), {
        kind: "home-undo",
        path: row.path,
        sha256: row.sha256,
        by,
        at: new Date().toISOString(),
      });
      for (const listener of listeners) listener();
    }
    return wrote;
  },
};
registerTimelineSource({
  read(works, by, documents, settingsOwners) {
    const roots = new Set(homes().map((home) => home.root));
    for (const work of works) {
      const document = documents.find((doc) =>
        work.binding === "address"
          ? doc.address !== null && sameAddress(work.target, doc.address)
          : work.binding === "open" &&
            work.open.session === doc.session &&
            work.open.openId === doc.openId,
      );
      const project = projectHome(document?.projectHome);
      if (project) roots.add(project);
    }
    const owners = new Set(settingsOwners);
    const log = events();
    const active = new Set(activeWrites(log));
    const rows = log.filter(
      (row): row is HomeWriteRow =>
        row.kind === "home-write" && owners.has(row.owner) && roots.has(row.home),
    );
    const latest = rows.findLast((row) => active.has(row) && row.by.kind === by);
    const undone = rows.findLast((row) => !active.has(row) && row.by.kind === by);
    const undoneAt =
      undone &&
      log.findLast(
        (event) =>
          event.kind === "home-undo" &&
          event.path === undone.path &&
          event.sha256 === undone.sha256,
      )?.at;
    return {
      rows: rows.map((row) => ({ ...row, undoable: active.has(row) && undoRefusal(row) === null })),
      undo: latest
        ? {
            ref: { home: latest.path, sha256: latest.sha256, label: latest.place },
            at: Date.parse(latest.at),
            refusal: undoRefusal(latest),
          }
        : null,
      redo: undone
        ? {
            ref: { home: undone.path, sha256: undone.sha256, label: undone.place },
            at: Date.parse(undoneAt ?? undone.at),
            refusal: "A home write is undone by saving again; redo is not supported.",
          }
        : null,
    };
  },
  async step(direction, ref, caller) {
    if (direction !== "undo" || !("home" in ref)) throw Error("Home writes support undo only.");
    return homeWriteSource.step(ref, caller);
  },
});

/** A tier's home for the target model: its folder and its name, or why there is none. */
/** Watch the concrete user/project files consumed by this read owner, including absent files. */
export function watchSettingTiers(changed: () => void) {
  const watching = new Map<string, () => void>();
  return {
    read(owner: string, pointer?: string | null) {
      const tiers = readSettingTiers(owner, pointer);
      for (const tier of tiers) {
        if (tier.tier === "firm" || tier.path === null || watching.has(tier.path)) continue;
        const path = resolve(tier.path);
        let previous = JSON.stringify(tier);
        let base = dirname(path);
        while (!existsSync(base) && dirname(base) !== base) base = dirname(base);
        const refresh = () => {
          const next = JSON.stringify(readTier(tier.tier, owner, pointer));
          if (next === previous) return;
          previous = next;
          changed();
        };
        const watcher = watch(base, { recursive: true, persistent: false }, (_event, file) => {
          const hint = file === null ? null : resolve(base, file.toString());
          const ancestor = hint === null ? "" : relative(hint, path);
          if (hint === null || (!ancestor.startsWith(`..${sep}`) && ancestor !== "..")) refresh();
        });
        watcher.on("error", changed);
        watching.set(tier.path, () => watcher.close());
      }
      return tiers;
    },
    close() {
      for (const stop of watching.values()) stop();
      watching.clear();
    },
  };
}

const listeners = new Set<() => void>();
/** A setting write on this host; the read graph invalidates its settings inputs on it. */
export const onSettingWritten = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export type SettingWrite =
  | {
      ok: true;
      tier: SettingTier;
      path: string;
      sha256: string;
      priorSha256: string | null;
      by: string;
      at: string;
    }
  | { ok: false; status: 404 | 409 | 422; message: string };

/**
 * Save one value at one tier. The file is rewritten with the value at `path` (null removes it) and
 * the writer's stamp, on the hash the writer read; a file changed since then is a conflict, and a
 * home that was not found is refused, never written somewhere else.
 */
export function writeSettingTier(
  request: {
    owner: string;
    tier: SettingTier;
    path: readonly string[];
    value: unknown;
    expectedSha256: string | null;
  },
  context: {
    pointer?: string | null;
    caller?: Caller;
    writer?: string;
    now?: () => Date;
    receiptId?: string;
    expectedPath?: string;
  } = {},
): SettingWrite {
  if (
    request.path.some((key) => ["written", "__proto__", "constructor", "prototype"].includes(key))
  )
    return { ok: false, status: 422, message: "The setting path contains a reserved key." };
  const owner = Object.hasOwn(settingOwners, request.owner)
    ? settingOwners[request.owner]
    : undefined;
  if (!owner?.accepts(request.path, request.value, request.tier))
    return {
      ok: false,
      status: 422,
      message: `No declared setting accepts ${request.owner} ${request.path.join(".")} with that value.`,
    };
  const read = readTier(request.tier, request.owner, context.pointer);
  if (read.home === null || read.path === null)
    return { ok: false, status: 404, message: read.notFound ?? `No ${request.tier} home` };
  if (context.expectedPath !== undefined && read.path !== context.expectedPath)
    return {
      ok: false,
      status: 409,
      message: `The setting home changed since binding: expected ${context.expectedPath}, now ${read.path}. Nothing was written.`,
    };
  if (read.error !== undefined)
    return {
      ok: false,
      status: 422,
      message: `${read.path} can't be read, so it is kept as it is: ${read.error}`,
    };
  if (read.sha256 !== request.expectedSha256)
    return { ok: false, status: 409, message: `${read.path} changed since it was read.` };
  const by = context.writer ?? userInfo().username;
  const at = (context.now?.() ?? new Date()).toISOString();
  const next = structuredClone((read.json ?? {}) as Record<string, unknown>);
  let node = next;
  for (const key of request.path.slice(0, -1)) {
    const child = node[key];
    node = node[key] =
      child !== null && typeof child === "object" && !Array.isArray(child)
        ? (child as Record<string, unknown>)
        : {};
  }
  const leaf = request.path.at(-1)!;
  if (request.value == null) delete node[leaf];
  else node[leaf] = request.value;
  next.written = { by, at };
  const wrote = writeHome(
    tierFileKind.in(hostState().home({ root: read.home, tier: request.tier }), request.owner),
    `${JSON.stringify(next, null, 2)}\n`,
    request.expectedSha256,
  );
  if (!wrote.ok)
    return { ok: false, status: 409, message: `${read.path} changed since it was read.` };
  appendLine(homeWritesKind.in(hostState()), {
    kind: "home-write",
    place: `${request.owner} ${request.path.join(".")} at ${request.tier}${read.name ? ` (${read.name})` : ""}`,
    path: read.path,
    home: read.home,
    owner: request.owner,
    tier: request.tier,
    sha256: wrote.sha256,
    priorSha256: wrote.priorSha256,
    by: context.caller ?? { kind: "human", via: "local" },
    at,
  });
  note(hostState(), {
    class: "keep",
    place: SETTING_WRITE_PLACE,
    path: read.path,
    sha256: wrote.sha256,
    reason: `${by} ${request.value == null ? "cleared" : `set ${JSON.stringify(request.value)} at`} ${request.owner} ${request.path.join(".")} in the ${request.tier} home${read.name ? ` (${read.name})` : ""}. ${
      wrote.priorSha256
        ? `The bytes before it are kept: sha256 ${wrote.priorSha256}.`
        : "The file is new."
    }${context.receiptId ? ` Receipt ${context.receiptId}.` : ""}`,
  });
  for (const listener of listeners) listener();
  return {
    ok: true,
    tier: request.tier,
    path: read.path,
    sha256: wrote.sha256,
    priorSha256: wrote.priorSha256,
    by,
    at,
  };
}

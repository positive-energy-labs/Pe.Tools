/**
 * The three guards (ADR 0038): synchronize with central, overwrite or discard a person's model
 * state, and send file bytes outward. Each is decided at the host's own door from who is calling
 * and what the document is, and answers "held" at once: nothing here waits on a person. They cover
 * Pea's own doors only; a shell command gets past them, so they catch mistakes, not adversaries.
 */
import { randomUUID } from "node:crypto";
import {
  held,
  type Caller,
  type GuardedAct,
  type HeldSend,
  type HeldSendRequest,
} from "@pe/agent-contracts";
import { CommandRejected } from "./command-executor.ts";

/**
 * Whose act this is. Only a human caller is the person; Pea, a Page, an MCP device and a caller
 * with no identity are all held, so an identity that cannot be read fails held.
 */
export const guards = (caller: Caller) => caller.kind !== "human";

/** What a door must know about a document to guard it; a fact that cannot be read counts against it. */
export type GuardedDocument = { title?: string | null; isFamily?: unknown; isModified?: unknown };
/** Guards 1 and 2 cover project documents only: a family document is never held (rule 3). */
const isProject = (doc: GuardedDocument) => doc.isFamily !== true;
const name = (doc: GuardedDocument | undefined) => `project document '${doc?.title ?? "(unnamed)"}'`;

/** The door's answer for a held act: thrown from `bind`, so nothing is dispatched. */
const hold = (act: GuardedAct, subject: string, how: string) =>
  new CommandRejected(held(act, subject, how));

/**
 * Pea saving over a project document. `central` is guard 1, `self` is guard 2. A save-as writes a
 * new path and is not held; a document the census does not name is held.
 */
export function guardSave(
  caller: Caller,
  to: "self" | "save-as" | "central",
  doc: GuardedDocument | undefined,
): void {
  if (!guards(caller) || to === "save-as" || (doc && !isProject(doc))) return;
  throw to === "central"
    ? hold("synchronize", name(doc), "The person presses Synchronize in Revit.")
    : hold("overwrite-or-discard", name(doc), "The person presses Save in Revit.");
}

/**
 * Pea stopping, closing, resetting, restarting or cleaning up over unsaved changes on a project
 * document. `docs` are the documents the act closes; `isModified` that is not a boolean is held.
 */
export function guardDiscard(caller: Caller, docs: readonly GuardedDocument[], verb: string): void {
  if (!guards(caller)) return;
  const unsaved = docs.find((doc) => isProject(doc) && doc.isModified !== false);
  if (unsaved)
    throw hold(
      "overwrite-or-discard",
      name(unsaved),
      `It has unsaved changes that this ${verb} would discard or save over; the person saves or closes it in Revit, then the ${verb} can run.`,
    );
}

/** A held outward send: the command names what would leave, so its journal can hold it by subject. */
export class SendHeld extends CommandRejected {
  constructor(readonly send: Pick<HeldSendRequest, "service" | "path" | "target">, where: string) {
    super(held("send-outward", `'${send.path}'`, `It would go to ${where}; it waits in the person's notices for their Confirm.`));
  }
}

/** Pea sending a file to an outside service through a host command (guard 3). */
export function guardSend(caller: Caller, send: SendHeld["send"], where: string): void {
  if (guards(caller)) throw new SendHeld(send, where);
}

/* ── Held outward sends: the one guarded act the person confirms from its notice row ───── */

const sends = new Map<string, HeldSend>();
type Person = Extract<Caller, { kind: "human" }>;
const continuations = new Map<string, (person: Person) => Promise<void>>();
const confirming = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const sendKey = (send: HeldSendRequest) => `${send.service}:${send.sha256}:${send.pages}`;

/**
 * Record a send Pea asked for and did not make. The same bytes and pages held twice are one row.
 * ponytail: in memory, so a host restart forgets held sends and Pea's next call holds again.
 */
export function holdSend(request: HeldSendRequest, thread: string | null, at: string): HeldSend {
  const prior = [...sends.values()].find((send) => sendKey(send) === sendKey(request));
  if (prior) return prior;
  const send = { ...request, id: randomUUID(), at, thread };
  sends.set(send.id, send);
  for (const listener of listeners) listener();
  return send;
}
export const heldSends = (): HeldSend[] => [...sends.values()];
export const heldSend = (id: string) => sends.get(id);
/** A command held before reading a source has an intent digest, not a digest of unread bytes. */
export function holdSendCommand(request: HeldSendRequest, thread: string | null, run: (person: Person) => Promise<void>) {
  const send = holdSend(request, thread, new Date().toISOString());
  if (!continuations.has(send.id)) continuations.set(send.id, run);
  return send;
}
/** Runs as `person`, the caller the confirm route authenticated. A failed run keeps its row for the next Confirm. */
export function confirmSend(send: HeldSend, person: Person, fallback: (send: HeldSend) => Promise<void>): Promise<void> {
  const pending = confirming.get(send.id);
  if (pending) return pending;
  const run = Promise.resolve().then(() => continuations.get(send.id)?.(person) ?? fallback(send)).then(() => releaseSend(send.id));
  confirming.set(send.id, run);
  return run.finally(() => confirming.delete(send.id));
}
/** The person confirmed it and the send ran, or the row is void: either way it leaves the feed. */
export function releaseSend(id: string) {
  continuations.delete(id);
  if (sends.delete(id)) for (const listener of listeners) listener();
}
export const subscribeHeldSends = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * The two guards (ADR 0038 and ADR 0052): synchronize with central, overwrite or discard a person's model
 * state. Each is decided at the host's own door from who is calling
 * and what the document is, and answers "held" at once: nothing here waits on a person. They cover
 * Pea's own doors only; a shell command gets past them, so they catch mistakes, not adversaries.
 */
import {
  held,
  type Caller,
  type GuardedAct,
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

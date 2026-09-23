/**
 * THE FACTS OF A VERB — what a browser verb shows and needs, resolved from its host record
 * (`RouteAction.does`) or its own declaration, in one place.
 */
import {
  hostActions,
  type ActionDefinition,
  type ActionNeed,
  type HostActionKey,
} from "@pe/agent-contracts";
import type { Ctx, RouteAction } from "./manifest";

/** The target a browser verb needs bound, from the host record's `needs`. */
export type TargetNeed = "host" | "session" | "document" | "project" | "family";
const targetNeeds = {
  nothing: "host",
  session: "session",
  document: "document",
  "project-document": "project",
  "family-document": "family",
} as const satisfies Record<ActionNeed, TargetNeed>;
export const targetNeed = (need: ActionNeed): TargetNeed => targetNeeds[need];

/** What a verb shows: its sentence, the target it needs, who may press it. */
export interface ActionFacts {
  says: string;
  needs: TargetNeed;
  actor: "any" | "human";
}
/** The slice of a host action record a browser verb projects. */
export type HostRecord = Pick<ActionDefinition, "says" | "needs" | "actor">;

/**
 * What a verb is. A host verb names its record by key, or picks it at press time (Ops picks the
 * selected operation's); it never restates the record's facts. A browser-local verb, which no
 * host action backs (a page change, a Work edit), says its own.
 */
export type ActionIdentity<W, R extends string, P> =
  | {
      does: HostActionKey | ((ctx: Ctx<W, R, P>) => HostRecord);
      says?: never;
      needs?: never;
      actor?: never;
    }
  | ({ does?: never } & ActionFacts);

/** The facts a verb shows now; the one place a `does` is looked up. */
export const actionFacts = <W, R extends string, P>(
  action: RouteAction<W, R, P, never>,
  ctx: Ctx<W, R, P>,
): ActionFacts => {
  if (action.does === undefined)
    return { says: action.says, needs: action.needs, actor: action.actor };
  const record = typeof action.does === "string" ? hostActions[action.does] : action.does(ctx);
  return { says: record.says, needs: targetNeed(record.needs), actor: record.actor };
};

/** The target need known before any press; undefined when the verb picks its record at press time. */
export const staticNeed = <W, R extends string, P>(
  action: RouteAction<W, R, P, never>,
): TargetNeed | undefined =>
  action.does === undefined
    ? action.needs
    : typeof action.does === "string"
      ? targetNeed(hostActions[action.does].needs)
      : undefined;

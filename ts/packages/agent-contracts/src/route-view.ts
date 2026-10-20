import { z } from "zod";

/**
 * Pea's rights over a mounted route view: the Page keys it may set by typed verb, and the policy it
 * reads in the capability description. The browser publishes a lease for the view it shows; Pea sets
 * the lease's keys; the browser applies the patch through the route's own Page and acknowledges the
 * render. Nothing here is Work. A route opts in by one entry; there is no per-route host door.
 */
export type RouteViewSpec = {
  title: string;
  /** What the person sees, and the rule Pea follows when it sets a key. */
  policy: string;
  /** The settable Page keys. A patch is a nonempty subset. */
  set: z.ZodObject<Record<string, z.ZodString>>;
  /** Input words beside the keys that `resolve` turns into keys (ducts: a system name). */
  words?: z.ZodObject<Record<string, z.ZodString>>;
  /** Turns the patch Pea wrote into one the lease can take, or refuses it by name. */
  resolve?: (
    input: Record<string, unknown>,
    facts: Record<string, unknown>,
  ) => { ok: true; patch: Record<string, string> } | { ok: false; error: string };
};

type DuctsFacts = {
  groups?: { id: string; systemNames: string[] }[];
  levels?: { id: string; name: string }[];
};

/** `system` is a person's word for a group; the lease's facts say which group ids carry it. */
function resolveDucts(input: Record<string, unknown>, facts: Record<string, unknown>) {
  const { system, ...rest } = input;
  const patch = { ...rest } as Record<string, string>;
  const { groups = [], levels = [] } = facts as DuctsFacts;
  if (typeof system === "string" && system.trim()) {
    const word = system.trim().toLowerCase();
    const exact = groups.filter((group) =>
      group.systemNames.some((name) => name.toLowerCase() === word),
    );
    const near = groups.filter((group) =>
      group.systemNames.some((name) => name.toLowerCase().includes(word)),
    );
    const found = exact.length ? exact : near;
    if (found.length !== 1)
      return {
        ok: false as const,
        error: found.length
          ? `system '${system}' names ${found.length} groups (${found.map((group) => group.id).join(", ")}); pass one group id`
          : `no group carries a system named '${system}'; read route:ducts.view for the group ids`,
      };
    patch.group = found[0]!.id;
  }
  if (patch.group && !groups.some((group) => group.id === patch.group))
    return { ok: false as const, error: `unknown group '${patch.group}'` };
  if (patch.level && !levels.some((level) => level.id === patch.level))
    return { ok: false as const, error: `unknown level '${patch.level}'` };
  return Object.keys(patch).length
    ? { ok: true as const, patch }
    : { ok: false as const, error: "name a system, group, level or selected element" };
}

export const routeViews = {
  families: {
    title: "Families",
    policy:
      "Change the query line of one mounted Families view. The browser acknowledges the rendered query and counts. No Work or Revit read.",
    set: z.strictObject({ query: z.string().max(4096) }),
  },
  ducts: {
    title: "Ducts",
    policy:
      "Move the Ducts page's subject in the person's open browser: group (a system's group id), level and selected element id; an empty string clears the key. Set the system only when the person named it, and never pick a system they did not name. Pass system as the person's word and the group is resolved from the view's facts; otherwise pass the group id read from route:ducts.view. No Work or Revit read.",
    set: z.strictObject({
      group: z.string().max(200),
      level: z.string().max(200),
      selected: z.string().max(200),
    }),
    words: z.strictObject({ system: z.string().max(200) }),
    resolve: resolveDucts,
  },
} satisfies Record<string, RouteViewSpec>;
export type RouteViewRoute = keyof typeof routeViews;
export const routeViewRoutes = Object.keys(routeViews) as [RouteViewRoute, ...RouteViewRoute[]];

/** The patch Pea sends: a nonempty subset of the route's settable keys. */
export const routeViewPatchSchema = (route: RouteViewRoute) =>
  (routeViews[route].set as RouteViewSpec["set"])
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, "a patch names at least one key");

/** Browser-owned Page state of one mounted, visible view. `page` holds exactly the settable keys. */
export const routeViewSchema = z.strictObject({
  route: z.enum(routeViewRoutes),
  thread: z.string().min(1),
  instance: z.uuid(),
  surface: z.enum(["chat", "route"]),
  page: z.record(z.string(), z.string()),
  /** Identity of what is shown (reading, document, Work). A command's ack fails if it moves. */
  context: z.record(z.string(), z.unknown()),
  /** What the shown page derives (counts, rule help, group ids). Read-only for Pea. */
  facts: z.record(z.string(), z.unknown()),
});
export type RouteView = z.infer<typeof routeViewSchema>;

export const routeViewSetSchema = z.strictObject({
  thread: z.string().min(1),
  instance: z.uuid(),
  revision: z.number().int().nonnegative(),
  patch: z.record(z.string(), z.string()),
});
export const routeViewAckSchema = z.strictObject({
  instance: z.uuid(),
  commandId: z.uuid(),
  revision: z.number().int().nonnegative(),
  page: z.record(z.string(), z.string()),
  facts: z.record(z.string(), z.unknown()),
});

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
  systems?: { name: string }[];
  levels?: { id: string; name: string }[];
};

/**
 * `system` is the page's subject, a Revit system name: the person's word resolves to the one
 * system the lease's facts name exactly (any case), else the one whose name holds it. A system
 * spans every duct network it is in; the page shows them all.
 */
function resolveDucts(input: Record<string, unknown>, facts: Record<string, unknown>) {
  const patch = { ...input } as Record<string, string>;
  const { systems = [], levels = [] } = facts as DuctsFacts;
  const stray = Object.keys(patch).filter((key) => !["system", "level", "selected"].includes(key));
  if (stray.length)
    return {
      ok: false as const,
      error: `the Ducts page takes system, level and selected, not ${stray.join(", ")}; name the system`,
    };
  if (patch.system?.trim()) {
    const word = patch.system.trim().toLowerCase();
    const exact = systems.filter((system) => system.name.toLowerCase() === word);
    const near = systems.filter((system) => system.name.toLowerCase().includes(word));
    const found = exact.length ? exact : near;
    if (found.length !== 1)
      return {
        ok: false as const,
        error: found.length
          ? `'${patch.system}' names ${found.length} systems (${found
              .slice(0, 12)
              .map((system) => system.name)
              .join(", ")}); name one`
          : `no system named '${patch.system}' on this page; read route:ducts.view for the system names`,
      };
    patch.system = found[0]!.name;
  }
  if (patch.level && !levels.some((level) => level.id === patch.level))
    return { ok: false as const, error: `unknown level '${patch.level}'` };
  return Object.keys(patch).length
    ? { ok: true as const, patch }
    : { ok: false as const, error: "name a system, level or selected element" };
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
      "Move the Ducts page's subject in the person's open browser: system (a Revit system name such as SA 19, as the person said it; it resolves against the view's system names), level and selected element id; an empty string clears the key. The page shows every duct network the system is in. Set the system only when the person named it, and never pick a system they did not name. No Work or Revit read.",
    set: z.strictObject({
      system: z.string().max(200),
      level: z.string().max(200),
      selected: z.string().max(200),
    }),
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

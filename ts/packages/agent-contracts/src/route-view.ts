import { z } from "zod";
import { routeAddress, routeViewRoutes, type RouteViewRoute } from "./route-address.ts";
import type { RouteGraphJson } from "./route-kernel-data.ts";

/**
 * The one codec a leased view crosses the browser/host boundary with: `write` the owner's Page as
 * the strings `RouteView.page` carries, `read` Pea's string patch back into the owner's values.
 * The builtin address's `agent` is one; an admitted route projects one from its graph's agent
 * fields through `bindings.codecs` (ADR 0030 rule 10). The host never decodes: it fences keys and
 * strings, and the Page owner's decode is the only decode.
 */
export interface ViewCodec {
  write(page: object): Record<string, string>;
  read(patch: Record<string, string>): object;
}

/** An admitted graph's field table (the kernel graph, not the RouteGraph projection). */
export type AdmittedFields = RouteGraphJson["fields"];
/** An admitted route's attention keys: the fields whose agent policy is not "none" (opt-in). */
export const agentFields = (fields: AdmittedFields, policy?: "read" | "set") =>
  Object.entries(fields).filter(
    ([, field]) => "agent" in field && field.agent !== "none" && (!policy || field.agent === policy),
  );

/** A builtin address that declares an `agent` lease, or null. */
export const builtinViewRoute = (route: string): RouteViewRoute | null =>
  routeViewRoutes.find((key) => key === route) ?? null;
/** One live registration as the workspace's admission owner projects it (read-only). */
export interface AdmittedView {
  key: string;
  title: string;
  address: string;
  fields: AdmittedFields;
}
/** A route that leases a view, as Pea discovers, opens and sets it. `builtin` names the builtin address. */
export interface ViewRoute extends Omit<AdmittedView, "fields"> {
  fields: AdmittedFields | null;
  builtin: RouteViewRoute | null;
}
/**
 * The one route-view identity authority (ADR 0030 rule 10): a builtin address with an `agent`
 * lease, or a live registration (`admitted`, from the admission owner) that opts a field in.
 * An unregistered key, and a registered Pod whose fields are all agent "none", lease nothing.
 */
export function viewRoute(route: string, admitted: AdmittedView | null): ViewRoute | null {
  const builtin = builtinViewRoute(route);
  if (builtin) {
    const { title, path } = routeAddress(builtin);
    return { key: builtin, title, address: path, fields: admitted?.fields ?? null, builtin };
  }
  return admitted?.key === route && agentFields(admitted.fields).length
    ? { ...admitted, builtin: null }
    : null;
}
/** Every leasing route once: builtin agent addresses, then registered opt-in admissions. */
export const viewRoutes = (admitted: readonly AdmittedView[]): ViewRoute[] => [
  ...routeViewRoutes.map((key) => viewRoute(key, admitted.find((each) => each.key === key) ?? null)!),
  ...admitted.flatMap((each) => (builtinViewRoute(each.key) ? [] : (viewRoute(each.key, each) ?? []))),
];
/** What an explicit open delivers: the registered address carrying the target. The browser owner decodes. */
export const viewOpenLink = (view: ViewRoute, target?: string) =>
  `${view.address}${target ? `?${new URLSearchParams({ target })}` : ""}`;

/**
 * Browser-owned Page state of one mounted, visible view. `page` holds exactly the agent keys.
 * `route` is a registered key, so its shape is checked here and its identity by `viewRoute` at the
 * one store that leases it; a builtin-only enum would refuse every registered Pod.
 */
export const routeViewSchema = z.strictObject({
  route: z.string().min(1).max(128),
  thread: z.string().min(1),
  instance: z.uuid(),
  /** The explicit open command this browser rendered; absent for ordinary human navigation. */
  openCommandId: z.uuid().optional(),
  surface: z.enum(["chat", "route"]),
  page: z.record(z.string(), z.string()),
  /** Identity of what is shown (reading, document, Work). A command's ack fails if it moves. */
  context: z.record(z.string(), z.unknown()),
  /** What the shown page derives (counts, rule help, group ids). Read-only for Pea. */
  facts: z.record(z.string(), z.unknown()),
});
export type RouteView = z.infer<typeof routeViewSchema>;

/**
 * An explicit open request. The host builds the link from the route's registered identity
 * (`viewOpenLink`), one path for builtins and Pods; the caller carries only the target.
 */
export const routeViewOpenSchema = z.strictObject({
  thread: z.string().min(1).max(256),
  target: z.string().max(8192).optional(),
});
export type RouteViewOpen = z.infer<typeof routeViewOpenSchema>;
/** What the host delivers to the browser currently showing this conversation. Never persisted/replayed. */
export const routeViewOpenedSchema = z.strictObject({
  thread: z.string().min(1).max(256),
  link: z.string().startsWith("/").max(8192),
});
export type RouteViewOpenIntent = z.infer<typeof routeViewOpenedSchema> & {
  type: "route-view-open";
  route: RouteView["route"];
  commandId: string;
};

export const routeViewSetSchema = z.strictObject({
  thread: z.string().min(1),
  instance: z.uuid(),
  revision: z.number().int().nonnegative(),
  patch: z.record(z.string(), z.string()),
});
/** Why a mounted Page refused Pea's patch: the one list, which the web Page owner's refusals use too. */
export const routeViewRefusalCodes = [
  "not-ready",
  "no-target",
  "busy",
  "stale-revision",
  "conflict",
  "partial",
  "unknown",
  "failed",
] as const;
export type RouteViewRefusalCode = (typeof routeViewRefusalCodes)[number];
const ackFence = {
  instance: z.uuid(),
  commandId: z.uuid(),
  revision: z.number().int().nonnegative(),
};
/**
 * The browser's answer to one command. `rendered`: the patched Page rendered (the page and facts it
 * shows). `refused`: the Page owner refused the patch whole; `page` is the page it still shows, as
 * its codec writes it, and proves nothing moved. A refusal carries no facts: nothing rendered.
 */
export const routeViewAckSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("rendered"),
    ...ackFence,
    page: z.record(z.string(), z.string()),
    facts: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    outcome: z.literal("refused"),
    ...ackFence,
    page: z.record(z.string(), z.string()),
    refusal: z.strictObject({
      code: z.enum(routeViewRefusalCodes),
      message: z.string().min(1).max(2000),
      detail: z.string().max(4000).optional(),
    }),
  }),
]);
export type RouteViewAck = z.infer<typeof routeViewAckSchema>;

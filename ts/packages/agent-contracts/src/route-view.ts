import { z } from "zod";
import { routeViewRoutes } from "./route-address.ts";

/** Browser-owned Page state of one mounted, visible view. `page` holds exactly the agent keys. */
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

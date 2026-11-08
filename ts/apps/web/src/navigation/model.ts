import {
  appRouteByPath,
  APP_TASKS,
  routePath as builtinRoutePath,
  routeKey as builtinRouteKey,
  type PodRouteDescriptor,
  type SurfaceShell,
} from "@pe/agent-contracts";
import { TOOLS } from "./catalogue";
import { publicRoutes } from "#/route/route-discovery";
import { isPodRoutePath, podRoutePath } from "#/route/pod-address";

// A registered route (builtin or trusted Pod) answers from its authenticated declaration; the generated
// table covers routes not registered yet. Read at call time, never at import.
export const routePath = (key: string) =>
  publicRoutes.typed(key)?.data.address ?? builtinRoutePath(key);
export const routeKey = (path: string) =>
  publicRoutes.byAddress(path)?.manifest.key ?? builtinRouteKey(path);
/** A Pod row opens its registered declaration's address; an unregistered row opens only its trust page. */
export const podPath = (row: PodRouteDescriptor) =>
  (row.trusted && publicRoutes.typed(row.workRoute)?.data.address) || podRoutePath(row.key);
export const TASKS = APP_TASKS;
const CATALOGUE = TOOLS;
/** Home and the shell's route icons. Without the global field, the pressed icon is the location. */
export function shellButtons(shell: SurfaceShell, pathname: string) {
  return [
    { path: shell.home.path, label: shell.home.label, iconKey: null },
    ...shell.icons.map((icon) => ({ ...icon, path: routePath(icon.route) })),
  ].map((button) => ({ ...button, pressed: shell.field !== "global" && button.path === pathname }));
}
export function locationLabel(path: string) {
  if (path === "/") return "Tools";
  const tool = CATALOGUE.find((entry) => path === entry.to || path.startsWith(`${entry.to}/`));
  return tool
    ? `${tool.title}${path === tool.to ? "" : ` / ${path.slice(tool.to.length + 1)}`}`
    : (publicRoutes.byAddress(path)?.manifest.name ?? appRouteByPath(path)?.title ?? path);
}
/** The one refusal for a resume door: stale inventory pauses Work, a missing URL says the host's reason. */
export function resumeRefusal(
  target: { url?: string | null; reason?: string | null },
  stale: boolean,
): string | undefined {
  if (stale) return "Refresh inventory before resuming Work";
  return target.url ? undefined : (target.reason ?? "No resumable destination");
}
export function friendlyObservation(observation: string) {
  const unreadable = /^([0-9]+) stored files could not be read or verified/.exec(observation);
  if (unreadable)
    return `${unreadable[1]} saved items could not be read. They were left unchanged.`;
  return observation;
}
/** The URL is an explicit destination, never a carry-forward of another route's thread/target. */
export function admittedDestination(destination: string, origin: string): string | null {
  try {
    const url = new URL(destination, origin);
    return url.origin === new URL(origin).origin &&
      ["http:", "https:"].includes(url.protocol) &&
      (appRouteByPath(url.pathname) || publicRoutes.byAddress(url.pathname) || isPodRoutePath(url.pathname))
      ? `${url.pathname}${url.search}${url.hash}`
      : null;
  } catch (error) { console.warn("ts/apps/web/src/navigation/model.ts: fallback after failure", error);
    return null;
  }
}

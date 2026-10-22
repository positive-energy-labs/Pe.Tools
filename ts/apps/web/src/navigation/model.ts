import {
  appRouteByPath,
  APP_TASKS,
  routePath as builtinRoutePath,
  routeKey as builtinRouteKey,
  type SurfaceShell,
} from "@pe/agent-contracts";
import { TOOLS } from "./catalogue";
import { podPathWork, podWorkPath, podPathName } from "#/route/pod-address";

export const routePath = (key: string) => podWorkPath(key) ?? builtinRoutePath(key);
export const routeKey = (path: string) => podPathWork(path) ?? builtinRouteKey(path);
export const TASKS = APP_TASKS;
const CATALOGUE = TOOLS;
export function matches(text: string, query: string) {
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((word) => text.toLowerCase().includes(word));
}
export function matchingTools(query: string) {
  return CATALOGUE.filter((tool) =>
    matches(
      `${tool.title} ${tool.label} ${tool.description} ${tool.aliases} ${tool.task} ${tool.to}`,
      query,
    ),
  );
}
/** Home and the shell's route icons. Without the global field, the pressed icon is the location. */
export function shellButtons(shell: SurfaceShell, pathname: string) {
  return [
    { path: shell.home.path, label: shell.home.label, iconKey: null },
    ...shell.icons.map((icon) => ({ ...icon, path: routePath(icon.route) })),
  ].map((button) => ({ ...button, pressed: shell.field !== "global" && button.path === pathname }));
}
export function locationLabel(path: string) {
  if (path === "/") return "Tools";
  const pod = podPathName(path);
  if (pod) return pod;
  const tool = CATALOGUE.find((entry) => path === entry.to || path.startsWith(`${entry.to}/`));
  return tool
    ? `${tool.title}${path === tool.to ? "" : ` / ${path.slice(tool.to.length + 1)}`}`
    : (appRouteByPath(path)?.title ?? path);
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
  const older = /^([0-9]+) legacy hash-only files/.exec(observation);
  if (older)
    return `${older[1]} older saved Works cannot be included in search yet. They remain available in their original tool and document.`;
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
      (appRouteByPath(url.pathname) || podPathWork(url.pathname))
      ? `${url.pathname}${url.search}${url.hash}`
      : null;
  } catch {
    return null;
  }
}

import { TOOLS } from "./catalogue";

export const TASKS = [
  "Start / open work",
  "Build / audit families",
  "Calculate loads & airflow",
  "Coordinate model data",
  "Ask / automate",
  "Explore / maintain",
] as const;
export type Task = (typeof TASKS)[number];
export type Exposure = "Main" | "Preview" | "Archive";
export type Tool = (typeof TOOLS)[number];
export const routeKey = (path: string) =>
  path === "/pea" ? "chat" : path === "/open" ? "instances" : path.slice(1);
export const routePath = (key: string) =>
  key === "index" ? "/" : key === "chat" ? "/pea" : key === "instances" ? "/open" : `/${key}`;
const TASK_BY_ROUTE: Record<string, Task> = {
  "/open": "Start / open work",
  "/family": "Build / audit families",
  "/families": "Build / audit families",
  "/takeoffs": "Calculate loads & airflow",
  "/rooms": "Calculate loads & airflow",
  "/grilles": "Calculate loads & airflow",
  "/duct-loss": "Calculate loads & airflow",
  "/captures": "Coordinate model data",
  "/schedules": "Coordinate model data",
  "/data-tables": "Coordinate model data",
  "/parameter-links": "Coordinate model data",
  "/pea": "Ask / automate",
  "/pods": "Ask / automate",
};
const MAIN = new Set([
  "/open",
  "/family",
  "/pea",
  "/families",
  "/takeoffs",
  "/grilles",
  "/duct-loss",
  "/settings",
]);
const ALIASES: Record<string, string> = {
  "/pea": "chat agent assistant threads",
  "/family": "rfa author build capture matrix",
  "/families": "audit reconcile parameters types",
  "/takeoffs": "manual j loads rhvac zones",
  "/rooms": "manual j loads regions",
  "/grilles": "wood floor submittal calculator pdf svg",
  "/duct-loss": "friction airflow pressure calculator",
  "/ops": "host api operations playground",
  "/open": "launcher model session documents",
};
const RUNTIME_NEEDS: Record<string, string> = {
  "/pea": "Host for conversation; Revit depends on the requested capability",
  "/family": "Revit for capture/apply; portable authoring is separate",
  "/grilles": "Browser calculation and export",
  "/duct-loss": "Browser calculation",
  "/design-system": "Browser component catalogue",
  "/param-tables": "Browser parameter-table workspace",
  "/settings": "Host settings",
  "/pods": "Host catalogue; Revit depends on the pod",
  "/doc-lab": "Host document parsing",
  "/ops": "Host operation; Revit depends on the operation",
};
export const CATALOGUE = TOOLS.map((tool) => ({
  ...tool,
  task: TASK_BY_ROUTE[tool.to] ?? "Explore / maintain",
  exposure: (MAIN.has(tool.to) ? "Main" : tool.to === "/lab" ? "Archive" : "Preview") as Exposure,
  aliases: ALIASES[tool.to] ?? tool.label,
  runtimeNeed: RUNTIME_NEEDS[tool.to] ?? "Revit for model actions; browsing saved data is separate",
}));
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
export function locationLabel(path: string) {
  if (path === "/") return "Tools";
  const tool = CATALOGUE.find((entry) => path === entry.to || path.startsWith(`${entry.to}/`));
  return tool
    ? `${tool.title}${path === tool.to ? "" : ` / ${path.slice(tool.to.length + 1)}`}`
    : path;
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
    return url.origin === new URL(origin).origin && ["http:", "https:"].includes(url.protocol)
      ? `${url.pathname}${url.search}${url.hash}`
      : null;
  } catch {
    return null;
  }
}

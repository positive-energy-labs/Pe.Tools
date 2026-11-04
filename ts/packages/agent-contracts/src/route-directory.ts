import type { RouteGraphJson } from "./route-kernel-data.ts";
import type { RouteDirectory } from "./route-graph.ts";

/** Shared directory input for web, Pea and the generated C# route table. */
export function projectKernelDirectory(data: RouteGraphJson): RouteDirectory {
  const { group, summary, ...metadata } = data.directory;
  return { ...metadata, path: data.address, title: data.name, category: group, blurb: summary };
}

import { routeDirectory } from "./generated/route-directory.ts";
export const APP_TASKS = [
  "Start / open work",
  "Build / audit families",
  "Calculate loads & airflow",
  "Coordinate model data",
  "Ask / automate",
  "Explore / maintain",
] as const;
export type AppTask = (typeof APP_TASKS)[number];
export type AppExposure = "Main" | "Preview" | "Archive";
export type AppSurface = "web" | "pwa" | "tray";
export type AppRouteMount = "full" | "compact";
export interface AppRoute {
  key: string;
  surfaces: Readonly<Record<AppSurface, AppRouteMount | false>>;
  path: string;
  title: string;
  label: string;
  description: string;
  iconKey:
    | "FileScan"
    | "FlaskConical"
    | "Image"
    | "Boxes"
    | "LayoutDashboard"
    | "LayoutGrid"
    | "Link2"
    | "Map"
    | "MessageSquare"
    | "Palette"
    | "Server"
    | "Settings2"
    | "Table"
    | "Table2"
    | "Terminal"
    | "Wind";
  task: AppTask;
  exposure: AppExposure;
  aliases: string;
  runtimeNeed: string;
  satellites?: readonly { to: string; label: string }[];
  directory: boolean;
  resume?: "document";
}

export const ROUTE_DIRECTORY: readonly AppRoute[] = routeDirectory.map(
  ({ directory: d, key }) => ({
    ...d,
    key,
    iconKey: d.icon as AppRoute["iconKey"],
    task: d.category as AppTask,
    description: d.blurb,
    aliases: d.aliases.join(" "),
    directory: d.listed,
  }),
);

export function appRouteByPath(path: string): AppRoute | undefined {
  return ROUTE_DIRECTORY.find(
    (route) => route.path === path || route.satellites?.some((satellite) => satellite.to === path),
  );
}
export function appRouteByKey(key: string): AppRoute | undefined {
  return ROUTE_DIRECTORY.find((route) => route.key === key || route.path.slice(1) === key);
}
export function routePath(key: string): string {
  return appRouteByKey(key)?.path ?? `/${key}`;
}
export function routeKey(path: string): string {
  return ROUTE_DIRECTORY.find((route) => route.path === path)?.key ?? path.slice(1);
}

/**
 * What one surface's shell may do. The app bar and the router read this record and never branch
 * on the surface name: a surface ruling is a change to this data, not a new `if`.
 */
export interface SurfaceShell {
  /** How a route mounts here. */
  mount: AppRouteMount;
  /** Route keys mounted locally; every other registered route opens a full window. */
  routes: "all" | readonly string[];
  home: { path: string; label: string };
  /** Route icons after Home. Without a picker, the pressed icon is the location. */
  icons: readonly {
    route: string;
    label: string;
    iconKey: "Inbox" | "MessageSquare" | "Settings2";
  }[];
  /**
   * The bar's field: `global` is the route field that opens the Ctrl+Shift+K open-work ledger;
   * `page` shows the route's name and opens its own Ctrl+K page palette, with no global search.
   */
  field: "global" | "page";
  /** Settings door: the quick popover, or the Settings route. Either way Settings must be in `routes`. */
  settings: "quick" | "route";
  /** Back and Forward: the browser's own, or drawn in the bar. */
  history: "browser" | "window";
}

const fullShell = {
  mount: "full",
  routes: "all",
  home: { path: "/", label: "Home / tool directory" },
  icons: [{ route: "chat", label: "Open Pea", iconKey: "MessageSquare" }],
  field: "global",
  settings: "quick",
} as const;

export const SURFACE_SHELLS: Readonly<Record<AppSurface, SurfaceShell>> = {
  web: { ...fullShell, history: "browser" },
  pwa: { ...fullShell, history: "window" },
  tray: {
    mount: "compact",
    routes: ["instances", "chat", "settings"],
    home: { path: "/open", label: "Home / open work" },
    icons: [
      { route: "chat", label: "Pea Inbox", iconKey: "Inbox" },
      { route: "settings", label: "Settings", iconKey: "Settings2" },
    ],
    field: "page",
    settings: "route",
    history: "window",
  },
};

export function appRouteMount(path: string, surface: AppSurface): AppRouteMount | undefined {
  const route = appRouteByPath(path);
  return route?.surfaces[surface] || undefined;
}

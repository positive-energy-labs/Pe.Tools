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
  mounts: Readonly<Partial<Record<AppSurface, AppRouteMount>>>;
}

const fullMounts = { web: "full", pwa: "full" } as const;
const compactMounts = { ...fullMounts, tray: "compact" } as const;

export const APP_ROUTES: readonly AppRoute[] = [
  {
    key: "instances",
    path: "/open",
    title: "Open",
    label: "Revit",
    iconKey: "Server",
    description:
      "Start a Revit, open a model, and see which Revit holds it: the launcher, every recent document across installed years, and each running Revit with its shape, documents and verbs.",
    task: "Start / open work",
    exposure: "Main",
    aliases: "launcher model session documents",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    directory: true,
    mounts: compactMounts,
  },
  {
    key: "family",
    path: "/family",
    title: "Family",
    label: "Family Foundry",
    iconKey: "Boxes",
    description:
      "One family, two lanes: an authored family.json (anatomy, matrix, build) or the family open in Revit's editor. Binding picks the lane; capture bridges them.",
    task: "Build / audit families",
    exposure: "Main",
    aliases: "rfa author build capture matrix",
    runtimeNeed: "Revit for capture/apply; portable authoring is separate",
    directory: true,
    resume: "document",
    mounts: fullMounts,
  },
  {
    key: "chat",
    path: "/pea",
    title: "Pea",
    label: "Workbench",
    iconKey: "MessageSquare",
    description: "The Pea agent workbench — chat and the context world inspector.",
    task: "Ask / automate",
    exposure: "Main",
    aliases: "chat agent assistant threads",
    runtimeNeed: "Host for conversation; Revit depends on the requested capability",
    directory: true,
    mounts: compactMounts,
  },
  {
    key: "families",
    path: "/families",
    title: "Families",
    label: "Family Foundry",
    iconKey: "Table2",
    description:
      "Every loaded family's types × parameters in one table — audit it against a profile, plan the reconciliation, apply with receipts.",
    task: "Build / audit families",
    exposure: "Main",
    aliases: "audit reconcile parameters types",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    directory: true,
    resume: "document",
    mounts: fullMounts,
  },
  {
    key: "takeoffs",
    path: "/takeoffs",
    title: "Takeoffs",
    label: "Manual J",
    iconKey: "Map",
    description:
      "The takeoff atlas — zones on the plan, rooms in the table, Manual J data through to a synced RHVAC .r10.",
    task: "Calculate loads & airflow",
    exposure: "Main",
    aliases: "manual j loads rhvac zones",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    directory: true,
    resume: "document",
    mounts: fullMounts,
  },
  {
    key: "rooms",
    path: "/rooms",
    title: "Rooms",
    label: "Manual J",
    iconKey: "LayoutDashboard",
    description:
      "Split a level's plan view into room regions, stage each room's name, type and loads, and write them to the regions in Revit.",
    task: "Calculate loads & airflow",
    exposure: "Preview",
    aliases: "manual j loads regions",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    directory: true,
    resume: "document",
    mounts: fullMounts,
  },
  {
    key: "grilles",
    path: "/grilles",
    title: "Grilles",
    label: "Wood floor grille",
    iconKey: "LayoutGrid",
    description:
      "The custom wood floor grille calculator — profiles in a sheet, the active one drawn to submittal scale, the buildable field charted; export a sheet to PDF or .svg.",
    task: "Calculate loads & airflow",
    exposure: "Main",
    aliases: "wood floor submittal calculator pdf svg",
    runtimeNeed: "Browser calculation and export",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "duct-loss",
    path: "/duct-loss",
    title: "Duct Loss",
    label: "Duct friction",
    iconKey: "Wind",
    description:
      "The imperial duct friction loss formula, live — type a duct and airflow, read Δp with every intermediate term beside the equation.",
    task: "Calculate loads & airflow",
    exposure: "Main",
    aliases: "friction airflow pressure calculator",
    runtimeNeed: "Browser calculation",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "pods",
    path: "/pods",
    title: "Pods",
    label: "Pods",
    iconKey: "Settings2",
    description:
      "Every installed pod — browse members, edit a spec as a form or raw JSON, and see the runs filed against it.",
    task: "Ask / automate",
    exposure: "Preview",
    aliases: "Pods",
    runtimeNeed: "Host catalogue; Revit depends on the pod",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "doc-lab",
    path: "/doc-lab",
    title: "Doc Lab",
    label: "Experimental",
    iconKey: "FileScan",
    description:
      "The grounded-document engine in isolation — parsed markdown beside the PDF pages, hover either side to link them.",
    task: "Explore / maintain",
    exposure: "Preview",
    aliases: "Experimental",
    runtimeNeed: "Host document parsing",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "lab",
    path: "/lab",
    title: "Lab",
    label: "Experimental",
    iconKey: "FlaskConical",
    description:
      "Composed glances — many host calls gathered into one drawing, run against a session you pick.",
    task: "Explore / maintain",
    exposure: "Archive",
    aliases: "Experimental",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "captures",
    path: "/captures",
    title: "Captures",
    label: "Revit data",
    iconKey: "Image",
    description:
      "Every picture taken of a Revit view, newest first — who took it, which view, the receipt, and the URL a page or a chat links.",
    task: "Coordinate model data",
    exposure: "Preview",
    aliases: "Revit data",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "ops",
    path: "/ops",
    title: "Ops Playground",
    label: "Host API",
    iconKey: "Terminal",
    description: "Call any host operation directly and inspect the raw response.",
    task: "Explore / maintain",
    exposure: "Preview",
    aliases: "host api operations playground",
    runtimeNeed: "Host operation; Revit depends on the operation",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "schedules",
    path: "/schedules",
    title: "Schedules",
    label: "Revit data",
    iconKey: "LayoutGrid",
    description:
      "Any Revit schedule as a grid — push staged cell values, capture its definition into a pod, or apply a saved spec as a new schedule.",
    task: "Coordinate model data",
    exposure: "Preview",
    aliases: "Revit data",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    directory: true,
    resume: "document",
    mounts: fullMounts,
  },
  {
    key: "data-tables",
    path: "/data-tables",
    title: "Data Tables",
    label: "Revit data",
    iconKey: "Table",
    description:
      "Author synthetic data tables — draft columns and keyed rows, then upsert them in one apply; rows deleted here are pruned in Revit.",
    task: "Coordinate model data",
    exposure: "Preview",
    aliases: "Revit data",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "param-tables",
    path: "/param-tables",
    title: "Parameter Tables",
    label: "Incubating product",
    iconKey: "Table2",
    description:
      "Five mounted parameter-table variants for linked engineering data; switch between them while the product shape is incubating.",
    task: "Explore / maintain",
    exposure: "Preview",
    aliases: "Incubating product",
    runtimeNeed: "Browser parameter-table workspace",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "parameter-links",
    path: "/parameter-links",
    title: "Parameter Links",
    label: "Revit data",
    iconKey: "Link2",
    description:
      "Cross-element parameter links — co-edit the link profile with pea, preview the projected target writes, then apply to reconcile them.",
    task: "Coordinate model data",
    exposure: "Preview",
    aliases: "Revit data",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "settings",
    path: "/settings",
    title: "Settings",
    label: "Pea",
    iconKey: "Settings2",
    description:
      "Whether Pea asks before each change. Providers and sign-in live in the machine drawer, behind the version chip.",
    task: "Explore / maintain",
    exposure: "Main",
    aliases: "Pea",
    runtimeNeed: "Host settings",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "design-system",
    path: "/design-system",
    title: "Design System",
    label: "Design language",
    iconKey: "Palette",
    description:
      "The spec and catalogue for the design language — production components under production tokens, with the gaps they cannot yet express marked in place.",
    satellites: [
      { to: "/design-system/band", label: "band" },
      { to: "/design-system/list", label: "list" },
      { to: "/design-system/arming", label: "arming" },
      { to: "/design-system/popovers", label: "popovers" },
      { to: "/design-system/swatch", label: "swatch" },
      { to: "/design-system/revit", label: "revit" },
    ],
    task: "Explore / maintain",
    exposure: "Preview",
    aliases: "Design language",
    runtimeNeed: "Browser component catalogue",
    directory: true,
    mounts: fullMounts,
  },
  {
    key: "bind",
    path: "/bind",
    title: "Bind",
    label: "Document",
    description: "Bind a document",
    iconKey: "Link2",
    task: "Start / open work",
    exposure: "Main",
    aliases: "document binding",
    runtimeNeed: "Host document bindings",
    directory: false,
    mounts: fullMounts,
  },
  {
    key: "index",
    path: "/",
    title: "Tools",
    label: "Tools",
    description: "Tools and saved work",
    iconKey: "LayoutGrid",
    task: "Explore / maintain",
    exposure: "Main",
    aliases: "home tools directory",
    runtimeNeed: "Host navigation",
    directory: false,
    mounts: fullMounts,
  },
  {
    key: "machine",
    path: "/machine",
    title: "Machine",
    label: "Machine",
    description: "Machine configuration and diagnostics",
    iconKey: "Server",
    task: "Explore / maintain",
    exposure: "Main",
    aliases: "providers sign-in diagnostics",
    runtimeNeed: "Host machine configuration",
    directory: false,
    mounts: compactMounts,
  },
];

export function appRouteByPath(path: string): AppRoute | undefined {
  return APP_ROUTES.find(
    (route) => route.path === path || route.satellites?.some((satellite) => satellite.to === path),
  );
}
export function appRouteByKey(key: string): AppRoute | undefined {
  return APP_ROUTES.find((route) => route.key === key || route.path.slice(1) === key);
}
export function routePath(key: string): string {
  return appRouteByKey(key)?.path ?? `/${key}`;
}
export function routeKey(path: string): string {
  return APP_ROUTES.find((route) => route.path === path)?.key ?? path.slice(1);
}
export function appRouteMount(path: string, surface: AppSurface): AppRouteMount | undefined {
  return appRouteByPath(path)?.mounts[surface];
}

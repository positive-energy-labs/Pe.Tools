// Product service identity — the POLICY layer over the SDK's vendored service client
// (./vendor/pe-service.ts). Naming mechanics (the worktree hash, a cross-language contract with the
// SDK's C# client) live in the SDK; this module owns only what is Pe.Tools-specific: the product
// root and the lane→name mapping.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSea } from "node:sea";
import {
  hostProcessIdentity,
  productIdentity,
  productInstallLayout,
  productPathNames,
} from "./contracts/product.ts";
import { documentsUserRoot, firmHome, insideTestRoot, projectHomeAbove, useHomesConfig, type Home,
} from "./product-paths.ts";
import { mintStatePath } from "./store-paths.ts";
import {
  derivedIn,
  type DerivedDir,
  type HomeRoot,
  type StateDirectory,
  type StateRoot,
  type StatePath,
} from "./kinds.ts";
export {
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
  hostProcessIdentity,
} from "./contracts/product.ts";
import { normalizeSourceRoot, sourceServiceName } from "./vendor/pe-service.ts";

export type HostLane = "dev" | "installed";

/** What a process was told about itself: by its parent's env/argv, the SDK, or its install manifest. */
export type RuntimeOwner = {
  readonly lane: HostLane;
  readonly sourceRoot: string | null;
  readonly installedRoot: string | null;
};

/**
 * Pure state root for a told owner: `<home>\.local-state` under a product home override, else the dev
 * checkout's `.artifacts/pe-tools`, else the install root itself. Machine state never lands at or
 * under a content home (ADR 0037 rule 6): `homes` is the home list, and every home in it fences.
 * The C# twin is `ProductPathing.StateRoot`; both suites assert `runtime-ownership.fixture.json`.
 */
export function stateRoot(
  lane: HostLane,
  ownerRoot: string,
  productHome?: string,
  homes: readonly Home[] = [],
): string {
  if (!isAbsolute(ownerRoot)) throw Error(`A ${lane} runtime needs an absolute owner root.`);
  if (lane === "installed" && productHome?.trim())
    throw Error(`An installed runtime does not run under ${productPathNames.productHomeVariable}.`);
  const stateOwner = resolve(productHome?.trim() || ownerRoot);
  const root = productHome?.trim()
    ? join(stateOwner, productPathNames.localStateDirectoryName)
    : lane === "dev"
      ? join(stateOwner, ".artifacts", "pe-tools")
      : ownerRoot;
  for (const home of homes) {
    // An override's `.local-state` sits in its own user home by design (an isolated run).
    if (home.tier === "user" && productHome?.trim()) continue;
    const fence = resolve(home.root.trim());
    const away = relative(fence, root);
    if (away !== ".." && !away.startsWith(`..${sep}`) && !isAbsolute(away))
      throw Error(`Machine state root '${root}' cannot be at or under ${fenceNames[home.tier]} '${fence}'.`);
  }
  return root;
}

// The words `runtime-ownership.fixture.json` pins for each fenced home.
const fenceNames = {
  user: "the user content root",
  project: "the project home",
  firm: productPathNames.sharedRootVariable,
} as const;

/** The owner's state root. Only an override can aim dev state at the installed namespace; that refuses. */
export function productRoot(owner: RuntimeOwner): string {
  const ownerRoot = owner.lane === "dev" ? owner.sourceRoot : owner.installedRoot;
  if (!ownerRoot) throw Error(`A ${owner.lane} runtime was not told its owner root.`);
  const override = process.env[productPathNames.productHomeVariable];
  // The homes known at process start. The default user home is named, never resolved: under a
  // test run it is only a fence, and resolving it would trip the isolation wire. A told firm
  // folder fences whether or not its marker proves it: state never lands on a named share.
  const told = process.env[productPathNames.sharedRootVariable]?.trim();
  const firm = told ? resolve(told) : firmHome().root;
  const root = stateRoot(owner.lane, ownerRoot, override, [
    ...(override?.trim() ? [] : [{ tier: "user" as const, root: documentsUserRoot() }]),
    ...(firm ? [{ tier: "firm" as const, root: firm }] : []),
  ]);
  const away = relative(osUserProductRoot(), root);
  if (owner.lane === "dev" && (away === "" || (!away.startsWith("..") && !isAbsolute(away))))
    throw Error(`Dev host cannot use installed product state '${root}'.`);
  insideTestRoot(root);
  // The fence above is drawn before the file is read: homes.json lives under this root, and its
  // writer refuses a home that holds the root, so a chosen home never moves or fences the state.
  useHomesConfig(stateTree(root).homesConfig);
  return root;
}

/**
 * Where the machine keeps what no home may hold (homes freeze shape 7), all under the state
 * root's `state` folder, the one an MSI upgrade keeps. Pod and Page ids are unique across homes,
 * so no key names a home. Pinned by `runtime-ownership.fixture.json` `stateTree`.
 *
 * This is the one table that mints a machine-state path, and the only minter of the store's
 * `StateRoot` (routes CONTRACTS K-A2): a state kind makes its path from what this returns, and
 * nothing else joins a path onto `state`. A new machine-state location is a row here.
 */
export function stateTree(root: string): StateRoot & {
  directory(...segments: string[]): StateDirectory;
  home(home: Home): HomeRoot;
} {
  const state = (...segments: string[]) =>
    mintStatePath(
    join(root, productPathNames.stateDirectoryName, ...segments));
  const paths = {
    /** The `state` folder itself: every state kind's root. */
    state: state(),
    /** The machine's one notice file; every process that refuses a stored file posts here. */
    notices: state(productPathNames.storedNoticesFileName),
    work: state("Work"),
    /** Page state, one folder per slug. */
    pages: state("Pages"),
    /** Run output, `<pod-id>\<run-id>`. */
    runs: state(productPathNames.runsDirectoryName),
    /** Where a run no pod owns writes. Not a pod id: an id cannot start with `_`. */
    podlessRuns: state(productPathNames.runsDirectoryName, productPathNames.podlessRunsDirectoryName),
    /** The write door's `blobRoot`: prior bytes rest in `sha256\<hash>` under it. */
    blobs: state(productPathNames.blobsDirectoryName),
    t3: state("T3"),
    agent: state("Agent"),
    /** Derived files of a source in no project home, `<key>.<sha256>` (the derived store's fallback). */
    derived: state(productPathNames.derivedDirectoryName),
    apsCredentials: state("aps-auth", "credentials.json"),
    apsTokens: state("aps-auth", "tokens.json"),
    /** One directory per harness thread (`harness/threads.ts`): `meta.json` + `events.jsonl`. */
    harnessThreads: state("harness-threads"),
    /** Immutable headless Ducts calculations, including their complete effective inputs. */
    ductsAnalyses: state("ducts", "analyses"),
    /** The copies Pea opens, so a person's own file is never her scratch. Model copies must not upload. */
    peaWork: state("pea-work"),
    /** User-added endpoint providers (`harness/providers.ts`). Holds keys: state, not Documents. */
    providers: state("providers.json"),
    /** The firm and user homes a person chose in Settings (`product-paths` `toldHome`). */
    homesConfig: state(productPathNames.homesConfigFileName),
    pluginDecisions: state("plugins.json"),
    shippedPods: state("shipped-pods"),
  };
  const machine: StateRoot = paths;
  return {
    ...paths,
    directory: (...segments: string[]): StateDirectory => stateDirectory(machine, ...segments),
    /** Bind a proven home to this machine, whose blob store keeps what a write into the home replaces. */
    home: (home: Home): HomeRoot => ({ ...home, machine }),
  };
}

/** Relative segments of a named row, obtained from the table instead of re-spelled by callers. */
export function stateSegments(row: keyof StateRoot): string[] {
  const layout = stateTree("");
  return relative(layout.state, layout[row]).split(/[\\/]/).filter(Boolean);
}

/** Bind a table row to its machine, retaining the machine's one notice and blob root. */
export function stateScope(machine: StateRoot, path: StatePath): StateDirectory {
  const scope = relative(machine.state, path);
  if (scope === ".." || scope.startsWith(`..${sep}`) || isAbsolute(scope))
    throw Error(`State scope belongs to another machine: ${path}`);
  return { path, machine };
}

export function stateDirectory(
  root: StateRoot | StateDirectory,
  ...segments: string[]
): StateDirectory {
  for (const segment of segments)
    if (!segment || segment === "." || segment === ".." || /[\\\\/]/.test(segment))
      throw Error(`Invalid state directory segment: ${segment}`);
  return {
    path: mintStatePath(join("path" in root ? root.path : root.state, ...segments)),
    machine: "machine" in root ? root.machine : root,
  };
}

/**
 * The derived store for a source file (ADR 0037 rule 6): the `Derived` folder of the project home
 * the first of `near` sits in, so every person on that project finds the same files; with no
 * project home, this machine's `state\Derived`. Never the user home, never a temp folder.
 */
export function derivedFor(root: string, ...near: string[]): DerivedDir {
  const tree = stateTree(root);
  const home = near.map((path) => projectHomeAbove(path)).find(Boolean);
  return derivedIn(home ? tree.home({ root: home, tier: "project" }) : tree);
}

/** OS-user product state namespace, independent of product-home overrides; test isolation still applies. */
export function osUserProductRoot(): string {
  return insideTestRoot(
    join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      productIdentity.vendorName,
      productIdentity.productName,
    ),
  );
}

/** The owner prefix every tray launch carries (`Pe.Host.Tray` Program.ParseOwner reads it); the tray never guesses. */
export function trayOwnerArguments(owner: RuntimeOwner): string[] {
  const root = owner.lane === "dev" ? owner.sourceRoot : owner.installedRoot;
  if (!root) throw Error(`A ${owner.lane} tray owner has no root.`);
  return ["--lane", owner.lane, "--root", root];
}

/** Product-owned temporary files follow the same lane as durable state. */
export const productScratchPath = (root: string): string => join(root, "scratch");

/** The owner's terminal context token, written by the host at start and read by the `pea` CLI. */
export const hostContextTokenPath = (root: string, serviceName: string): string =>
  join(root, "state", "service", `${serviceName}.context`);

/**
 * An installed executable's root is the install its SDK manifest names: strip the manifest's own
 * relative entry path from the executable and require `product.payloads.json` for this product there.
 */
export function installedRuntimeRoot(
  app: "host" | "pea",
  executablePath = process.execPath,
  bundled = isSea(),
): string {
  const entry = productInstallLayout[`VersionedApp:${app}`];
  const root = resolve(executablePath, ...entry.split("/").map(() => ".."));
  const manifest = join(root, "product.payloads.json");
  if (
    !bundled ||
    normalizeSourceRoot(join(root, entry)) !== normalizeSourceRoot(executablePath) ||
    !existsSync(manifest)
  )
    throw Error(`Installed ${app} must execute from an SDK install ('${manifest}' is missing).`);
  const decoded: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof decoded !== "object" || decoded === null ||
      !("product" in decoded) || decoded.product !== productIdentity.productName ||
      !("vendor" in decoded) || decoded.vendor !== productIdentity.vendorName)
    throw Error(`Installed ${app} manifest '${manifest}' names another product.`);
  return insideTestRoot(root);
}

/** Worktree-scoped dev-host name for a checkout root (SDK hash — byte-stable across languages). */
export function sourceHostServiceName(sourceRoot: string): string {
  return sourceServiceName(hostProcessIdentity.serviceName, sourceRoot);
}

/**
 * The dev frontend's preferred port for a checkout. The MAIN checkout (its `.git` is a directory) is
 * the dev lane's identity and keeps `DEV_LANE_FRONTEND_PORT`, the origin of the owner's installed
 * "Pe.Tools Dev" PWA. Every linked worktree (`.git` is a file) takes a stable slot in 5200-5999
 * derived from the same hash as its dev host's service name, so worktrees run beside main and each
 * other. Vite walks to the next free port on a collision; the host learns the origin that actually
 * bound (dev.ts), never this number.
 */
export const DEV_LANE_FRONTEND_PORT = 5175;
export const DEV_FRONTEND_PORTS = { first: 5200, count: 800 } as const;
export function devFrontendPort(sourceRoot: string): number {
  // An isolated product home shares the checkout; it takes any free port, never the owner's.
  if (process.env[productPathNames.productHomeVariable]?.trim()) return 0;
  if (statSync(join(sourceRoot, ".git"), { throwIfNoEntry: false })?.isDirectory())
    return DEV_LANE_FRONTEND_PORT;
  const hash = /([0-9a-f]{8})[0-9a-f]*$/.exec(sourceHostServiceName(sourceRoot))?.[1];
  if (!hash) throw new Error("Dev host service name carries no checkout hash.");
  return DEV_FRONTEND_PORTS.first + (Number.parseInt(hash, 16) % DEV_FRONTEND_PORTS.count);
}

/**
 * The checkout's language roots, named once. C# mirror: `TsHostLauncher` (the one C# spelling of
 * the TS root). Everything else derives paths from a checkout root through these.
 */
export const checkoutLayout = { ts: "ts", dotnet: "dotnet" } as const;

/**
 * A Pe.Tools checkout root — the ONE dev identity input, hashed by host, MCP clients, pea, and the
 * C# launcher alike. A `.git` entry (dir in the main checkout, file in a linked worktree) with
 * `Pe.Tools.slnx` beside it. Walks up like git does, so identity follows where the WORK is.
 */
export function checkoutRootFrom(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git")) && existsSync(join(dir, "Pe.Tools.slnx"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Spawn plumbing: a supervisor tells the host it just spawned which checkout it serves. */
export const sourceRootVariable = "PE_TOOLS_SOURCE_ROOT";

/**
 * The service name for a host lane: the installed host is the one global name; a dev host derives a
 * stable worktree-scoped name from its checkout root, alongside that checkout's state root.
 */
export function hostServiceName(lane: HostLane, sourceRoot: string | null): string {
  if (lane === "installed") return hostProcessIdentity.serviceName;
  if (!sourceRoot) throw new Error("A dev host requires a source root for service identity.");
  return sourceHostServiceName(sourceRoot);
}

/** Ownership authorizes execution; matching ownership does not attest loaded code freshness. */
export function runtimeOwnerRejection(
  expected: {
    lane: HostLane;
    sourceRoot: string | null;
    serviceName: string;
    installedRoot?: string | null;
  },
  actual: {
    lane?: string | null;
    sourceRoot?: string | null;
    serviceName?: string | null;
    installedRoot?: string | null;
  },
): string | null {
  if (actual.lane !== expected.lane)
    return `Runtime lane '${actual.lane ?? "unknown"}' does not match '${expected.lane}'.`;
  if (actual.serviceName !== expected.serviceName)
    return `Runtime service '${actual.serviceName ?? "unknown"}' does not match '${expected.serviceName}'.`;
  if (expected.lane === "dev") {
    if (
      !actual.sourceRoot ||
      !expected.sourceRoot ||
      normalizeSourceRoot(actual.sourceRoot) !== normalizeSourceRoot(expected.sourceRoot)
    )
      return `Runtime checkout '${actual.sourceRoot ?? "unknown"}' does not match '${expected.sourceRoot}'.`;
    if (actual.installedRoot) return "Checkout runtime must not report an installation root.";
  } else {
    if (actual.sourceRoot) return "Installed runtime must not report a checkout source root.";
    if (
      !expected.installedRoot ||
      !actual.installedRoot ||
      normalizeSourceRoot(actual.installedRoot) !== normalizeSourceRoot(expected.installedRoot)
    )
      return `Runtime installation '${actual.installedRoot ?? "unknown"}' does not match '${expected.installedRoot ?? "unknown"}'.`;
  }
  return null;
}

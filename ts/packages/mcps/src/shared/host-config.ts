import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostProcessIdentity, scriptingWorkspaceIdentity } from "@pe/host-contracts/contracts";
import { discoverServiceSync } from "@pe/host-contracts/pe-service";
import {
  devHostSourceDir,
  hostServiceName,
  productRoot,
} from "@pe/host-contracts/service-identity";
import { firstNonBlank } from "./cli-values.ts";

/**
 * A Pe.Tools checkout root: a `.git` entry (dir in the main checkout, file in a linked worktree)
 * with `Pe.Tools.slnx` beside it. Walks up like git does, so identity follows where the WORK is.
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

function sourceRootFromModule(): string | null {
  const modulePath = normalize(fileURLToPath(import.meta.url));
  const marker = `${normalize("packages/mcps/src").toLowerCase()}\\`;
  const index = modulePath.toLowerCase().indexOf(marker);
  return index >= 0 ? modulePath.slice(0, index - 1) : null;
}

/**
 * Identity by location, like git. Precedence: spawn-plumbing env (a supervisor telling the child
 * it just spawned who it is — never user configuration) → cwd walk (an agent working in a worktree
 * automatically addresses that worktree's host) → module path (last resort: where this code lives).
 * Every candidate is mapped through {@link devHostSourceDir} — the service-name hash is over the
 * host's `source/pe-tools` dir, NEVER the checkout root, and every deriver must agree byte-for-byte.
 */
function resolveLaneAndRoot(): { lane: "dev" | "installed"; sourceRoot: string | null } {
  const configured = process.env.PE_LANE?.trim().toLowerCase();
  const envSourceRoot = process.env.PE_TOOLS_HOST_SOURCE_DIR?.trim() || null;
  const cwdRoot = checkoutRootFrom(process.cwd());
  const located =
    (envSourceRoot ? (devHostSourceDir(envSourceRoot) ?? envSourceRoot) : null) ??
    (cwdRoot ? devHostSourceDir(cwdRoot) : null) ??
    sourceRootFromModule();
  const lane =
    configured === "installed"
      ? ("installed" as const)
      : configured === "dev" || located
        ? ("dev" as const)
        : ("installed" as const);
  return { lane, sourceRoot: lane === "dev" ? located : null };
}

/**
 * A non-URL `--host` value is a lane token: `installed`, `dev` (this location's worktree), or a
 * path inside any checkout — resolved to that worktree's live service file through the same
 * byte-stable name hash the hosts register under. Returns undefined when the token is a URL.
 */
function laneTokenBaseUrl(token: string): string | null | undefined {
  if (/^https?:\/\//i.test(token)) return undefined;
  if (token.toLowerCase() === "installed") {
    const live = discoverServiceSync(productRoot(), hostServiceName("installed", null));
    return live ? `http://127.0.0.1:${live.port}` : hostProcessIdentity.defaultHostBaseUrl;
  }
  const walked =
    token.toLowerCase() !== "dev" && isAbsolute(token) ? checkoutRootFrom(token) : null;
  const root =
    token.toLowerCase() === "dev"
      ? resolveLaneAndRoot().sourceRoot
      : walked
        ? devHostSourceDir(walked)
        : null;
  if (!root) {
    throw new Error(
      token.toLowerCase() === "dev"
        ? "host token 'dev': no Pe.Tools checkout at or above the current location."
        : `host token '${token}' is neither a URL, 'installed', 'dev', nor a path inside a Pe.Tools checkout.`,
    );
  }
  const live = discoverServiceSync(productRoot(), hostServiceName("dev", root));
  return live ? `http://127.0.0.1:${live.port}` : null;
}

/**
 * Discover this runtime's host base URL without failing: an explicit value or env override wins
 * (URL or lane token: `installed` | `dev` | a worktree path), else this lane/worktree's LIVE
 * service file (pid-checked — a crashed host's leftover file is never routed to), else the
 * installed preferred-port default on the installed lane only. Returns null when the dev host for
 * this worktree is simply not running — the default port belongs to whichever worktree claimed it
 * first, so falling back there would silently cross worktrees.
 */
export function discoverHostBaseUrl(value?: string): string | null {
  const explicit = firstNonBlank(value, process.env[hostProcessIdentity.hostBaseUrlVariable]);
  if (explicit) {
    const fromToken = laneTokenBaseUrl(explicit);
    return fromToken === undefined ? explicit : fromToken;
  }
  const { lane, sourceRoot } = resolveLaneAndRoot();
  const live = discoverServiceSync(productRoot(), hostServiceName(lane, sourceRoot));
  if (live) return `http://127.0.0.1:${live.port}`;
  return lane === "installed" ? hostProcessIdentity.defaultHostBaseUrl : null;
}

/** Strict form for call time: like {@link discoverHostBaseUrl}, but a missing dev host is an error. */
export function resolveHostBaseUrl(value?: string): string {
  const discovered = discoverHostBaseUrl(value);
  if (discovered) return discovered;
  const { sourceRoot } = resolveLaneAndRoot();
  throw new Error(
    `No running dev host for this worktree${sourceRoot ? ` (${sourceRoot})` : ""}. ` +
      `Start it with \`vp run @pe/host#dev\`, or pass an explicit host base URL or lane token ` +
      `(--host <url | installed | dev | worktree-path> / ${hostProcessIdentity.hostBaseUrlVariable}).`,
  );
}

export function resolveWorkspaceKey(value?: string): string {
  return firstNonBlank(value) ?? scriptingWorkspaceIdentity.defaultWorkspaceKey;
}

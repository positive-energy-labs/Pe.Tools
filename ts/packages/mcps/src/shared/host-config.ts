import { isAbsolute } from "node:path";
import { hostProcessIdentity, scriptingWorkspaceIdentity } from "@pe/host-contracts/contracts";
import { discoverServiceSync } from "@pe/host-contracts/pe-service";
import {
  checkoutRootFrom,
  hostServiceName,
  productRoot,
  sourceRootVariable,
} from "@pe/host-contracts/service-identity";
import { firstNonBlank } from "./cli-values.ts";

/**
 * Identity by location, like git. Precedence: spawn-plumbing env (a supervisor telling the child
 * it just spawned who it is — never user configuration) → cwd walk (an agent working in a worktree
 * automatically addresses that worktree's host) → module path (last resort: where this code lives).
 * Every candidate is a checkout root, the one string every deriver hashes.
 */
function resolveLaneAndRoot(): { lane: "dev" | "installed"; sourceRoot: string | null } {
  const configured = process.env.PE_LANE?.trim().toLowerCase();
  const located =
    process.env[sourceRootVariable]?.trim() ||
    (checkoutRootFrom(process.cwd()) ?? checkoutRootFrom(import.meta.dirname));
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
  const root =
    token.toLowerCase() === "dev"
      ? resolveLaneAndRoot().sourceRoot
      : isAbsolute(token)
        ? checkoutRootFrom(token)
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

import { normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { hostProcessIdentity, scriptingWorkspaceIdentity } from "@pe/host-contracts/contracts";
import { discoverServiceSync } from "@pe/host-contracts/pe-service";
import { hostServiceName, productRoot } from "@pe/host-contracts/service-identity";
import { firstNonBlank } from "./cli-values.ts";

function sourceRootFromModule(): string | null {
  const modulePath = normalize(fileURLToPath(import.meta.url));
  const marker = `${normalize("packages/mcps/src").toLowerCase()}\\`;
  const index = modulePath.toLowerCase().indexOf(marker);
  return index >= 0 ? modulePath.slice(0, index - 1) : null;
}

function resolveLaneAndRoot(): { lane: "dev" | "installed"; sourceRoot: string | null } {
  const configured = process.env.PE_LANE?.trim().toLowerCase();
  const envSourceRoot = process.env.PE_TOOLS_HOST_SOURCE_DIR?.trim() || null;
  const inferred = sourceRootFromModule();
  const lane =
    configured === "installed"
      ? ("installed" as const)
      : configured === "dev" || envSourceRoot || inferred
        ? ("dev" as const)
        : ("installed" as const);
  return { lane, sourceRoot: lane === "dev" ? (envSourceRoot ?? inferred) : null };
}

/**
 * Discover this runtime's host base URL without failing: an explicit value or env override wins,
 * else this lane/worktree's LIVE service file (pid-checked — a crashed host's leftover file is
 * never routed to), else the installed preferred-port default on the installed lane only. Returns
 * null when the dev host for this worktree is simply not running — the default port belongs to
 * whichever worktree claimed it first, so falling back there would silently cross worktrees.
 */
export function discoverHostBaseUrl(value?: string): string | null {
  const explicit = firstNonBlank(value, process.env[hostProcessIdentity.hostBaseUrlVariable]);
  if (explicit) return explicit;
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
      `Start it with \`vp run @pe/host#dev\`, or pass an explicit host base URL ` +
      `(--host / ${hostProcessIdentity.hostBaseUrlVariable}).`,
  );
}

export function resolveWorkspaceKey(value?: string): string {
  return firstNonBlank(value) ?? scriptingWorkspaceIdentity.defaultWorkspaceKey;
}

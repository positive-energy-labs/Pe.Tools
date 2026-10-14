import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  HOST_CONTEXT_VARIABLE,
  hostProcessIdentity,
  scriptingWorkspaceIdentity,
} from "@pe/host-contracts/contracts";
import { discoverServiceSync, normalizeSourceRoot } from "@pe/host-contracts/pe-service";
import { productInstallLayout } from "@pe/host-contracts/contracts";
import {
  checkoutRootFrom,
  hostContextTokenPath,
  productRoot,
  runtimeOwnerRejection,
} from "@pe/host-contracts/service-identity";
import { firstNonBlank } from "./cli-values.ts";

export { resolveLaneAndRoot } from "@pe/runtime/runtime-owner";
import { resolveLaneAndRoot } from "@pe/runtime/runtime-owner";

/**
 * A non-URL `--host` value is a lane token: `installed`, `dev` (this location's worktree), or a
 * path inside the same checkout. Returns undefined when the token is a URL.
 */
function laneTokenBaseUrl(token: string): string | null | undefined {
  if (/^https?:\/\//i.test(token)) return undefined;
  const expected = resolveLaneAndRoot();
  if (token.toLowerCase() === "installed") {
    if (expected.lane !== "installed")
      throw Error("A checkout CLI cannot execute against the installed host.");
    return discoverOwnHost(expected);
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
  const rejection = runtimeOwnerRejection(expected, {
    lane: "dev",
    sourceRoot: root,
    serviceName: expected.serviceName,
  });
  if (rejection) throw Error(rejection);
  return discoverOwnHost(expected);
}

function discoverOwnHost(expected: ReturnType<typeof resolveLaneAndRoot>): string | null {
  const live = discoverServiceSync(productRoot(), expected.serviceName);
  if (!live) return null;
  if (
    expected.lane === "installed" &&
    (!live.executablePath ||
      normalizeSourceRoot(live.executablePath) !==
        normalizeSourceRoot(
          join(expected.installedRoot!, productInstallLayout["VersionedApp:host"]),
        ))
  )
    throw Error("Installed host receipt has no verified canonical executable location.");
  const rejection = runtimeOwnerRejection(expected, {
    ...live,
    installedRoot: expected.lane === "installed" ? expected.installedRoot : null,
    serviceName: expected.serviceName,
  });
  if (rejection) throw Error(rejection);
  return `http://127.0.0.1:${live.port}`;
}

/**
 * Discover only this runtime's live service receipt. Explicit selectors must name that same
 * owner and address. A missing receipt returns null; an unverifiable selector refuses execution.
 */
export function discoverHostBaseUrl(value?: string): string | null {
  const explicit = firstNonBlank(value, process.env[hostProcessIdentity.hostBaseUrlVariable]);
  if (explicit) {
    const fromToken = laneTokenBaseUrl(explicit);
    if (fromToken !== undefined) return fromToken;
    const own = discoverOwnHost(resolveLaneAndRoot());
    if (!own || explicit.replace(/\/+$/, "") !== own)
      throw Error(`Host URL '${explicit}' is not this runtime's verified service address.`);
    return own;
  }
  return discoverOwnHost(resolveLaneAndRoot());
}

/** Strict form for call time: like {@link discoverHostBaseUrl}, but a missing dev host is an error. */
export function resolveHostBaseUrl(value?: string): string {
  const discovered = discoverHostBaseUrl(value);
  if (discovered) return discovered;
  const { sourceRoot, lane } = resolveLaneAndRoot();
  throw new Error(
    `No running ${lane} host for this runtime${sourceRoot ? ` (${sourceRoot})` : ""}. Start its matching host before execution.`,
  );
}

export function resolveWorkspaceKey(value?: string): string {
  return firstNonBlank(value) ?? scriptingWorkspaceIdentity.defaultWorkspaceKey;
}

/**
 * BUILD-RULES ruling 1: the owner's own terminal crosses as a human. A process that already
 * carries a context (a harness child and its shell) keeps it; otherwise the `pea` CLI adopts the
 * token its host wrote at start. No host running means no token, and the CLI stays anonymous.
 */
export function adoptTerminalContext() {
  if (process.env[HOST_CONTEXT_VARIABLE]) return;
  try {
    const token = readFileSync(hostContextTokenPath(resolveLaneAndRoot().serviceName), "utf8");
    if (token.trim()) process.env[HOST_CONTEXT_VARIABLE] = token.trim();
  } catch {
    // No host has written a token for this runtime: reads only.
  }
}

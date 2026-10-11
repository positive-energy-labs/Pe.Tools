import { isAbsolute, join } from "node:path";
import { isSea } from "node:sea";
import { hostProcessIdentity, scriptingWorkspaceIdentity } from "@pe/host-contracts/contracts";
import { discoverServiceSync, normalizeSourceRoot } from "@pe/host-contracts/pe-service";
import { productInstallLayout } from "@pe/host-contracts/contracts";
import {
  checkoutRootFrom,
  hostServiceName,
  productRoot,
  sourceRootVariable,
  runtimeOwnerRejection,
  installedRuntimeRoot,
} from "@pe/host-contracts/service-identity";
import { firstNonBlank } from "./cli-values.ts";

/**
 * Source modules execute for their actual checkout. Spawn plumbing and cwd must agree with it.
 * Installed SEA executables execute only from their canonical manifest location.
 */
export function resolveLaneAndRoot(): {
  lane: "dev" | "installed";
  sourceRoot: string | null;
  serviceName: string;
  installedRoot: string | null;
} {
  const configured = process.env.PE_LANE?.trim().toLowerCase();
  if (configured && configured !== "dev" && configured !== "installed")
    throw Error(`Unknown runtime lane '${configured}'.`);
  const bundled = isSea();
  const moduleRoot = bundled ? null : checkoutRootFrom(import.meta.dirname);
  if (configured === "installed" && moduleRoot)
    throw Error("Source CLI code cannot claim the installed runtime lane.");
  const cwdRoot = checkoutRootFrom(process.cwd());
  const lane: "installed" | "dev" = bundled ? "installed" : "dev";
  if (configured && configured !== lane)
    throw Error(
      `Configured runtime lane '${configured}' does not match the executable lane '${lane}'.`,
    );
  if (!bundled && !moduleRoot)
    throw Error("Source CLI code requires its actual Pe.Tools checkout.");
  const sourceRoot = lane === "dev" ? moduleRoot : null;
  if (lane === "installed" && process.env[sourceRootVariable]?.trim())
    throw Error("An installed CLI cannot claim a checkout source root.");
  // This shared context runs in both packaged Host and Pea. Infer only a canonical Host entry;
  // all remaining installed callers must pass the canonical Pea validator (copies still refuse).
  const installedApp =
    normalizeSourceRoot(process.execPath) ===
    normalizeSourceRoot(join(productRoot(), productInstallLayout["VersionedApp:host"]))
      ? "host"
      : "pea";
  const installedRoot = lane === "installed" ? installedRuntimeRoot(installedApp) : null;
  const baseServiceName = hostServiceName(lane, sourceRoot);
  const serviceName =
    process.env[hostProcessIdentity.serviceNameVariable]?.trim() || baseServiceName;
  if (
    serviceName !== baseServiceName &&
    !(lane === "dev" && serviceName === `${baseServiceName}-no-revit`)
  )
    throw Error(`Configured host service '${serviceName}' does not belong to this runtime.`);
  const owner = { lane, sourceRoot, installedRoot, serviceName };
  if (lane === "dev") {
    for (const candidate of [process.env[sourceRootVariable]?.trim(), cwdRoot]) {
      if (!candidate) continue;
      const rejection = runtimeOwnerRejection(owner, { ...owner, sourceRoot: candidate });
      if (rejection) throw Error(rejection);
    }
  }
  return owner;
}

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

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { hostProcessIdentity } from "./contracts/product.ts";

export type HostLane = "dev" | "installed";

export function normalizeSourceRoot(sourceRoot: string): string {
  return resolve(sourceRoot).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

export function sourceHostServiceName(sourceRoot: string): string {
  const digest = createHash("sha256")
    .update(normalizeSourceRoot(sourceRoot), "utf8")
    .digest("hex")
    .slice(0, 12);
  return `${hostProcessIdentity.serviceName}-source-${digest}`;
}

export function hostServiceName(lane: HostLane, sourceRoot: string | null): string {
  if (lane === "installed") return hostProcessIdentity.serviceName;
  if (!sourceRoot) throw new Error("A dev host requires a source root for service identity.");
  return sourceHostServiceName(sourceRoot);
}

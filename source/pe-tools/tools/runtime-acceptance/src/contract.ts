export type AcceptanceProfile = "deterministic" | "showcase";

export interface AcceptanceGate {
  readonly id: string;
  readonly lifecycle: readonly string[];
  readonly proves: string;
}

const deterministic: readonly AcceptanceGate[] = [
  { id: "authority", lifecycle: ["none"], proves: "one pinned SDK and Pe.Tools candidate" },
  { id: "rrd-baseline", lifecycle: ["live status"], proves: "the RRD coexistence sentinel" },
  {
    id: "attached-and-fresh",
    lifecycle: ["test attached", "test fresh"],
    proves: "both test lanes preserve the RRD incarnation",
  },
  {
    id: "source-sandbox",
    lifecycle: ["sandbox start", "sandbox restart", "sandbox stop"],
    proves: "source routing and immutable generation replacement",
  },
  {
    id: "installed-sandbox",
    lifecycle: ["sandbox start", "sandbox stop"],
    proves: "checkout-free installed payload discovery and operation",
  },
  {
    id: "hot-reload-coexistence",
    lifecycle: ["live converge"],
    proves:
      "one host operation changes and restores behavior while every lane keeps its incarnation",
  },
  {
    id: "routing-and-service",
    lifecycle: ["none"],
    proves: "service identity and exact selectors through public Pe.Tools HTTP",
  },
  {
    id: "worktree-coexistence",
    lifecycle: ["sandbox start", "sandbox restart", "sandbox stop"],
    proves: "RRD plus sandbox, two sandboxes, and failed-build preservation",
  },
  {
    id: "no-save-close",
    lifecycle: ["sandbox stop"],
    proves: "ordinary close discards unsaved changes without persistence",
  },
  {
    id: "cleanup",
    lifecycle: ["sandbox stop", "live status"],
    proves: "owned processes are gone and the RRD identity is unchanged",
  },
] as const;

const showcase: readonly AcceptanceGate[] = [
  {
    id: "pea-chat",
    lifecycle: ["sandbox start", "sandbox stop"],
    proves: "a real Pea chat turn can select, use, and ordinarily stop a sandbox",
  },
] as const;

export function acceptancePlan(profile: AcceptanceProfile): readonly AcceptanceGate[] {
  return profile === "deterministic" ? deterministic : showcase;
}

export interface SdkEnvelope {
  readonly result: Record<string, unknown>;
  readonly resolved: Record<string, unknown>;
  readonly diagnostics: readonly unknown[];
  readonly nextSteps: readonly unknown[];
  readonly guide: string;
  readonly related: readonly unknown[];
}

export function parseSdkEnvelope(stdout: string): SdkEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("pe-revit stdout was not one JSON object");
  }
  if (
    !isRecord(value) ||
    !isRecord(value.result) ||
    !isRecord(value.resolved) ||
    !Array.isArray(value.diagnostics) ||
    !Array.isArray(value.nextSteps) ||
    typeof value.guide !== "string" ||
    !Array.isArray(value.related)
  )
    throw new Error("pe-revit stdout was not an SDK envelope");
  return value as unknown as SdkEnvelope;
}

export interface ProcessIdentity {
  readonly pid: number;
  readonly processStartUtc: string;
}

export function liveIdentity(envelope: SdkEnvelope): ProcessIdentity {
  const bridges = envelope.result.bridges;
  if (!Array.isArray(bridges)) throw new Error("live status has no bridges");
  const addins = Array.isArray(envelope.result.addins) ? envelope.result.addins : [];
  const addinPids = addins
    .filter(isRecord)
    .map((row) => row.pid)
    .filter((pid): pid is number => typeof pid === "number");
  const candidates = bridges.filter((bridge) => {
    if (!isRecord(bridge)) return false;
    const pid = bridge.pid ?? bridge.Pid;
    return addinPids.length === 0 || addinPids.includes(pid as number);
  });
  if (candidates.length !== 1 || !isRecord(candidates[0]))
    throw new Error(`live status resolved ${candidates.length} process identities`);
  const bridge = candidates[0];
  const pid = bridge.pid ?? bridge.Pid;
  if (typeof pid !== "number" || typeof bridge.processStartUtc !== "string")
    throw new Error("live status bridge lacks pid + processStartUtc");
  return { pid, processStartUtc: bridge.processStartUtc };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

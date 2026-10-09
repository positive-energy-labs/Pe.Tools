import type {
  DocumentInfo,
  ProcessIdentity,
  SessionDocument,
  SessionObservation,
  UpdatePlan,
  UpdateReceipt,
} from "@pe/host-contracts/pe-revit-contract";
import type { Access, Readiness } from "./harness-thread.ts";
import type { DocumentRef } from "./target.ts";

/** Last confirmed data lives in the field; a failed attempt changes only this evidence. */
export interface MachineLeg {
  readonly observedAtUtc: string | null;
  readonly attemptedAtUtc: string | null;
  readonly error: string | null;
}

export interface Machine {
  readonly observedAtUtc: string;
  readonly host: MachineHost | null;
  readonly revit: {
    readonly years: readonly number[] | null;
    readonly sessions: readonly MachineSession[] | null;
    readonly unclassifiedAttachments: readonly MachineAttachment[];
  };
  readonly update: MachineUpdate;
  readonly share: MachineShare | null;
  readonly providers: readonly MachineProvider[] | null;
  readonly access: Access | null;
  readonly legs: Readonly<Record<string, MachineLeg>>;
}

export interface MachineHost {
  readonly serviceName: string;
  readonly instanceId: string;
  readonly version: string;
  readonly payload: "installed" | "checkout";
  readonly process: Pick<ProcessIdentity, "pid" | "processStartUtc">;
  readonly port: number;
  /** The service record cannot distinguish login, icon and command launches. */
  readonly startedBy: "login" | "icon" | "command" | null;
  /** Null when the Windows registry cannot be read. */
  readonly autostart: "on" | "off" | "disabled-in-windows" | null;
  readonly sourceRoot: string | null;
  readonly uptimeSeconds: number;
  readonly canonicalUrl: string;
  readonly peers: readonly MachinePeer[];
}

export interface MachinePeer {
  readonly serviceName: string;
  readonly instanceId: string;
  readonly version: string;
  readonly sourceRoot: string | null;
  readonly process: Pick<ProcessIdentity, "pid" | "processStartUtc">;
  readonly url: string;
  readonly reachable: boolean;
}

/** Product socket evidence, not SDK custody. Documents keep the product openId namespace. */
export interface MachineAttachment {
  readonly session: string;
  readonly pid: number;
  readonly processStartUtcUnixMs: number | null;
  readonly documents: readonly DocumentRef[] | null;
}

export interface MachineSession {
  readonly row: SessionObservation;
  readonly attachment: MachineAttachment | null;
  /** Observed documents have no persistence metadata on beta.186's doc-list wire. */
  readonly documents:
    | readonly (DocumentInfo | (SessionDocument & { readonly persistence: null }))[]
    | null;
  readonly documentsLeg: MachineLeg;
}

export interface MachineUpdate {
  readonly plan: UpdatePlan | null;
  readonly receipt: UpdateReceipt | null;
  readonly requestId: string | null;
  readonly admittedPlanId: string | null;
  readonly planLeg: MachineLeg;
  readonly receiptLeg: MachineLeg;
}

/** Wave 4 implements the Serve adapter; desired intent never proves an active mapping. */
export interface MachineShare {
  readonly desired: "off" | "on";
  readonly state: "off" | "on" | "refused" | "unknown";
  readonly url: string | null;
  readonly refusal: { readonly code: string; readonly detail: string } | null;
  readonly callers: readonly {
    readonly login: string;
    readonly lastAtUtc: string;
    readonly door: "web" | "pe" | "mcp";
  }[];
  readonly refused: readonly {
    readonly atUtc: string;
    readonly code: string;
    readonly from: string;
  }[];
}

export interface MachineProvider {
  readonly id: string;
  readonly readiness: Readiness;
}

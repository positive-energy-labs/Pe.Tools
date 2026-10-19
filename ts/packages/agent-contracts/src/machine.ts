import type { DiscoveryMachine } from "./discovery-machine.ts";
import type {
  DocumentInfo,
  DocumentHoldings,
  ProcessIdentity,
  SessionDocument,
  SessionObservation,
  UpdatePlan,
  UpdateReceipt,
} from "@pe/host-contracts/pe-revit-contract";
import type { DocumentIdentityAuthority } from "@pe/host-contracts/contracts";
import type { NativeNotice } from "@pe/host-contracts/native-adapter";
import type { Access, Provider } from "./harness-thread.ts";
import { addressSchema, type DocumentRef, type TargetInventory } from "./target.ts";

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
  /** Host/Revit ownership only; never a code-freshness claim. */
  readonly runtimeMatch?: "verified" | "disconnected" | "unknown" | "refused";
  readonly runtimeRefusal?: string | null;
  readonly installedRoot?: string | null;
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
  /**
   * Windows RedirectionGuard on this host process, inherited from whatever started it (msiexec).
   * `enforced` means this host and every harness CLI it spawns cannot traverse user junctions.
   */
  readonly redirectionTrust: "enforced" | "audit" | "off" | null;
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

/**
 * What a caller may do to one open document, projected on the host (ADR 0016/0017). `pea` is a
 * document Pea's own acquisition created (its id is what cleanup and handover name); `rw` is a
 * thread grant. The browser draws access from this and from nothing else.
 */
export type MachineAccess =
  | { readonly kind: "pea"; readonly acquisition: string }
  | { readonly kind: "read" }
  | {
      readonly kind: "rw";
      readonly context: string;
      readonly label: string;
      readonly until: string;
    };

/** A document as the product socket names it, with what it grants. */
export interface MachineAttachmentDocument extends DocumentRef {
  readonly title: string;
  readonly address: string | null;
  readonly isFamilyDocument: boolean;
  readonly isActive: boolean;
  readonly access: MachineAccess;
}

/** Product socket evidence, not SDK custody. */
export interface MachineAttachment {
  readonly session: string;
  readonly pid: number;
  readonly processStartUtcUnixMs: number | null;
  /** Set when the payload attested its openIds are the SDK's; null means no SDK join, so no write. */
  readonly documentIdentity: DocumentIdentityAuthority | null;
  readonly documents: readonly MachineAttachmentDocument[] | null;
}

export interface MachineSession {
  /** Provenance label: an acquisition started this Revit. Never write authority (access is). */
  readonly whose: "you" | "pea";
  readonly row: SessionObservation;
  readonly attachment: MachineAttachment | null;
  /** Observed documents have no persistence metadata on beta.186's doc-list wire. */
  readonly documents:
    | readonly (DocumentInfo | (SessionDocument & { readonly persistence: null }))[]
    | null;
  readonly documentsLeg: MachineLeg;
  /** SDK openId namespace. Null is unread, never an empty holdings census. */
  readonly holdings: readonly DocumentHoldings[] | null;
  readonly holdingsLeg: MachineLeg;
}

export interface MachineUpdate {
  readonly plan: UpdatePlan | null;
  readonly receipt: UpdateReceipt | null;
  readonly requestId: string | null;
  readonly admittedPlanId: string | null;
  readonly planLeg: MachineLeg;
  readonly receiptLeg: MachineLeg;
  /** Install eligible updates without asking; on unless the person turned it off. */
  readonly automatic: boolean;
}

/**
 * One tray card item: a projection of one receipt revision on the `notices` Reading, never a source of
 * truth. `id` + `revision` are the receipt's own, so a later revision replaces its earlier item. `href` opens in the app window; absent opens the panel.
 */
export type MachineNotice = NativeNotice;

/** Wave 4 implements the Serve adapter; desired intent never proves an active mapping. */
export interface MachineShare {
  readonly allowRemoteAdministration: boolean;
  readonly desired: "off" | "on";
  /** `needs-tailscale` is a state, not a refusal: the `tailscale` CLI is not installed on this machine. */
  readonly state: "off" | "on" | "refused" | "unknown" | "needs-tailscale";
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

export type MachineProvider = Provider;

/** Resolver view of the host's evidence; an unread or failed leg never proves absence. */
export function machineInventory(machine: Machine | DiscoveryMachine | undefined): TargetInventory {
  if (!machine || machine.revit.sessions === null) return { kind: "checking" };
  for (const key of ["sessions", "attachments"]) {
    const leg = machine.legs[key];
    if (leg?.error) return { kind: "failed", message: leg.error };
    if (!leg?.observedAtUtc) return { kind: "checking" };
  }
  const attachments = [
    ...machine.revit.sessions.flatMap((s) => (s.attachment ? [s.attachment] : [])),
    ...machine.revit.unclassifiedAttachments,
  ];
  return {
    kind: "ready",
    sessions: Object.fromEntries(
      attachments.map((attachment) => {
        const execution = machine.revit.sessions!.find(
          (s) => s.attachment?.session === attachment.session,
        )?.row.execution;
        return [
          attachment.session,
          attachment.documents === null
            ? { kind: "checking" }
            : execution?.allowed !== true
              ? {
                  kind: "failed",
                  message: execution?.detail ?? "Runtime ownership is not verified",
                }
              : {
                  kind: "ready",
                  values: attachment.documents.map((doc) => ({
                    openId: doc.openId,
                    address: addressSchema.safeParse(doc.address).data ?? null,
                    kind: doc.isFamilyDocument ? "family" : "project",
                  })),
                },
        ];
      }),
    ),
  };
}

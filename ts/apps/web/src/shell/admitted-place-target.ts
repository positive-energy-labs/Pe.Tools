import {
  resolveCallTarget,
  canonicalRouteInput,
  type CallTarget,
  type DocumentRequest,
  type ExecutionTarget,
  type TargetInventory,
  type TargetResolution,
} from "@pe/agent-contracts";

type Needs = Exclude<CallTarget, { needs: "session" }>["needs"];
export interface PlaceTargetProjection<Value> {
  readonly resolution: TargetResolution;
  readonly identity: ExecutionTarget | null;
  /** Resolution eligibility only; command admission/consent still owns permission. */
  readonly writableTarget: ExecutionTarget | null;
  readonly retained: Value | null;
  readonly picker: readonly DocumentRequest[];
  readonly reconnect: boolean;
}

/** Target identity survives an inventory gap. Work remains owned by K1, never copied here. */
export function createPlaceTarget(options: {
  readonly needs: Needs;
  readonly current: () => boolean;
  readonly pick: (request: DocumentRequest) => void;
  readonly reconnect: () => void;
}) {
  let request: DocumentRequest | null = null;
  let identity: ExecutionTarget | null = null;
  let inventory: TargetInventory = { kind: "checking" };
  let resolution: TargetResolution = { kind: "checking" };
  let picker: DocumentRequest[] = [];
  return {
    update(next: TargetInventory, explicit?: DocumentRequest | null) {
      inventory = next;
      if (explicit !== undefined) request = explicit;
      picker = [];
      if (next.kind === "ready") {
        for (const [session, documents] of Object.entries(next.sessions)) {
          if (documents.kind !== "ready") continue;
          for (const doc of documents.values) {
            if (options.needs === "family-document" && doc.kind !== "family") continue;
            if (options.needs === "project-document" && doc.kind !== "project") continue;
            picker.push({ kind: "open", ref: { session, openId: doc.openId } });
          }
        }
      }
      const incomplete =
        next.kind !== "ready" ||
        Object.values(next.sessions).some((documents) => documents.kind !== "ready");
      // A sole default becomes an exact lifetime pin, never a replacement on later census.
      if (!request && !incomplete && picker.length === 1) request = picker[0]!;
      resolution = resolveCallTarget(
        { needs: options.needs },
        request ? [request] : picker,
        inventory,
      );
      if (!request && incomplete && options.needs !== "nothing") {
        resolution = next.kind === "failed" ? next : { kind: "checking" };
      }
      if (resolution.kind === "resolved") identity = resolution.target;
    },
    project<Value>(
      retained: { readonly target: ExecutionTarget; readonly value: Value } | null,
    ): PlaceTargetProjection<Value> {
      const live = resolution.kind === "resolved" ? resolution.target : null;
      const same = !retained || canonicalRouteInput(retained.target) === canonicalRouteInput(live);
      return Object.freeze({
        resolution,
        identity,
        writableTarget: options.current() && same ? live : null,
        retained: retained?.value ?? null,
        picker: Object.freeze([...picker]),
        reconnect:
          resolution.kind === "checking" ||
          resolution.kind === "failed" ||
          (resolution.kind === "choose" &&
            ["session-gone", "document-closed"].includes(resolution.reason)),
      });
    },
    pick(next: DocumentRequest): boolean {
      if (!options.current()) return false;
      const resolved = resolveCallTarget({ needs: options.needs, target: next }, [], inventory);
      if (resolved.kind !== "resolved") return false;
      options.pick(next);
      return true;
    },
    reconnect(): boolean {
      if (!options.current()) return false;
      options.reconnect();
      return true;
    },
  };
}

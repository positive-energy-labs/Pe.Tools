/** Transient routing to the journal that owns a wire request. No execution or writable state lives here. */
import { nativeProgressSchema, type NativeProgress } from "@pe/agent-contracts";
import { z } from "zod";

/** A native operation reports progress on the event `<operationKey>.progress`. */
export const PROGRESS_EVENT = ".progress";
const progressFrame = z.strictObject({
  requestId: z.string().min(1),
  progress: nativeProgressSchema,
});

export type DispatchRefusal = { kind: "cancelled" | "refused"; message: string };
type Owner = {
  refusal(): DispatchRefusal | null | Promise<DispatchRefusal | null>;
  validate(): Promise<DispatchRefusal | null>;
  dispatched(transport: "bridge" | "sdk"): Promise<void>;
  terminal?(touched: unknown, evidenceJson?: string | null): Promise<void>;
  progress?(value: NativeProgress): Promise<void>;
  uncertain?(reason: "lost-response" | "process-exit"): Promise<void>;
};
const owners = new Map<string, Owner>();
export function bindActionDispatch(id: string, owner: Owner) {
  if (owners.has(id)) throw Error("A native request already has a journal owner");
  owners.set(id, owner);
  return () => {
    if (owners.get(id) === owner) owners.delete(id);
  };
}
export const dispatchRefusal = (id: string) => Promise.resolve(owners.get(id)?.refusal() ?? null);
export const validateDispatch = (id: string) => owners.get(id)?.validate() ?? Promise.resolve(null);
export const markDispatched = (id: string, transport: "bridge" | "sdk") =>
  owners.get(id)?.dispatched(transport) ?? Promise.resolve();
export const recordNativeTerminal = (id: string, touched: unknown, evidenceJson?: string | null) =>
  owners.get(id)?.terminal?.(touched, evidenceJson) ?? Promise.resolve();
export async function recordNativeProgress(
  eventName: string,
  payload: string | null | undefined,
  lookup: (requestId: string) => { operationKey: string; phase: string } | undefined,
): Promise<void> {
  const { requestId, progress } = progressFrame.parse(JSON.parse(payload ?? "null"));
  const request = lookup(requestId);
  if (request?.phase === "dispatched" && request.operationKey + PROGRESS_EVENT === eventName)
    await owners.get(requestId)?.progress?.(progress);
}
export const recordNativeUncertainty = (id: string, reason: "lost-response" | "process-exit") =>
  owners.get(id)?.uncertain?.(reason) ?? Promise.resolve();

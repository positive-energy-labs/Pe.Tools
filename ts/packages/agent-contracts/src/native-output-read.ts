import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { generatedJsonSchema, nativeRequestSchema, nativeResponseSchema } from "@pe/host-contracts/native-schemas";
import type { HostOperationKey, OpRequestOf, OpResponseOf } from "@pe/host-contracts/operation-types";
import { captureReceiptSchema, VIEW_IMAGE_KEY, FOCUSED_VIEW_IMAGE_KEY, type ViewImageKey, type CaptureReceipt } from "./capture.ts";
import { executionTargetSchema, type ExecutionTarget } from "./target.ts";

/** The read and its focused twin (a SessionWrite) answer the same image; the host keeps both as captures. */
export const isViewImage = (key: string): key is ViewImageKey =>
  key === VIEW_IMAGE_KEY || key === FOCUSED_VIEW_IMAGE_KEY;
export type NativeReadOutput<K extends HostOperationKey> = K extends ViewImageKey
  ? Omit<OpResponseOf<K>,"filePath"> & {capture:CaptureReceipt|null;imageUrl:string|null} : OpResponseOf<K>;
const viewImage=(key:ViewImageKey)=>{
  const entry=hostOpCatalog.find(op=>op.key === key)!;
  const json=JSON.parse(entry.responseSchemaJson);
  delete json.properties.filePath;
  json.required=json.required.filter((name:string)=>name !== "filePath");
  json.properties.capture=z.toJSONSchema(captureReceiptSchema.nullable());
  json.required.push("capture");
  return generatedJsonSchema(json);
};
const image=new Map<ViewImageKey,z.ZodType>();
/** The host owns asset delivery; the C# DTO remains the raw native execution contract. */
export const nativeOutputSchema=<K extends HostOperationKey>(key:K):z.ZodType<NativeReadOutput<K>> =>
  (isViewImage(key) ? image.get(key) ?? image.set(key, viewImage(key)).get(key)! : nativeResponseSchema(key)) as z.ZodType<NativeReadOutput<K>>;
export function nativeOutputAssets(key:string,value:unknown):string[] {
  if(!isViewImage(key)) return [];
  const result=captureReceiptSchema.nullable().parse((value as {capture:unknown}).capture);
  if (!result) return [];
  return [result.sha];
}

/**
 * A native read's one input and one value (CONTRACTS.md, "The native handle's input"): the op's
 * request, the target it runs against, and for a retained body the version it holds and its role.
 * `native(key)` in `handle.ts` and the host's native body both decode with these.
 */
const role = z.enum(["acquire", "validate", "join", "beyond", "none"]);
export const nativeArgs = z.object({
  key: z.string(),
  request: z.unknown(),
  target: executionTargetSchema,
  version: z.string().optional(),
  // Retained ducts bodies name their role; every other read leaves it out.
  role: role.optional(),
});
export type NativeArgs<K extends HostOperationKey> = {
  request: OpRequestOf<K>;
  target: ExecutionTarget;
  version?: string;
  role?: z.output<typeof role>;
};
export type NativeValue<K extends HostOperationKey> = {
  body: NativeReadOutput<K>;
  version: string | null;
};
export const nativeReadInput = <K extends HostOperationKey>(key: K): z.ZodType<NativeArgs<K>> =>
  nativeArgs.omit({ key: true }).extend({ request: nativeRequestSchema(key) });
export const nativeReadValue = <K extends HostOperationKey>(key: K): z.ZodType<NativeValue<K>> =>
  z.object({ body: nativeOutputSchema(key), version: z.string().nullable() });

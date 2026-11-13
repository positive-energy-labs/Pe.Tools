import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { generatedJsonSchema, nativeRequestSchema, nativeResponseSchema } from "@pe/host-contracts/native-schemas";
import type { HostOperationKey, OpRequestOf, OpResponseOf } from "@pe/host-contracts/operation-types";
import { captureReceiptSchema, type CaptureReceipt } from "./capture.ts";
import { executionTargetSchema, type ExecutionTarget } from "./target.ts";

export type NativeReadOutput<K extends HostOperationKey> = K extends "revit.context.view-image"
  ? Omit<OpResponseOf<K>,"filePath"> & {capture:CaptureReceipt;imageUrl:string|null} : OpResponseOf<K>;
const viewImage=()=>{
  const entry=hostOpCatalog.find(op=>op.key === "revit.context.view-image")!;
  const json=JSON.parse(entry.responseSchemaJson);
  delete json.properties.filePath;
  json.required=json.required.filter((name:string)=>name !== "filePath");
  json.properties.capture=z.toJSONSchema(captureReceiptSchema);
  json.required.push("capture");
  return generatedJsonSchema(json);
};
let image:z.ZodType|undefined;
/** The host owns asset delivery; the C# DTO remains the raw native execution contract. */
export const nativeOutputSchema=<K extends HostOperationKey>(key:K):z.ZodType<NativeReadOutput<K>> =>
  (key === "revit.context.view-image" ? image ??= viewImage() : nativeResponseSchema(key)) as z.ZodType<NativeReadOutput<K>>;
export function nativeOutputAssets(key:string,value:unknown):string[] {
  if(key !== "revit.context.view-image") return [];
  const result=captureReceiptSchema.parse((value as {capture:unknown}).capture);
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
export const nativeReadInput = <K extends HostOperationKey>(key: K) =>
  nativeArgs.omit({ key: true }).extend({ request: nativeRequestSchema(key) }) as z.ZodType<NativeArgs<K>>;
export const nativeReadValue = <K extends HostOperationKey>(key: K) =>
  z.object({ body: nativeOutputSchema(key), version: z.string().nullable() }) as z.ZodType<NativeValue<K>>;

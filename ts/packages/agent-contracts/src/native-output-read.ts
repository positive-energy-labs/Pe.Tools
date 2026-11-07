import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { generatedJsonSchema, nativeResponseSchema } from "@pe/host-contracts/decoders";
import type { HostOperationKey, OpResponseOf } from "@pe/host-contracts/operation-types";
import { captureReceiptSchema, type CaptureReceipt } from "./capture.ts";

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

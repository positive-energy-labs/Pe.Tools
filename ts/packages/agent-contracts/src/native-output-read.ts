import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { generatedJsonSchema, nativeResponseSchema } from "@pe/host-contracts/native-schemas";
import type { HostOperationKey, OpResponseOf } from "@pe/host-contracts/operation-types";
import { captureReceiptSchema, VIEW_IMAGE_KEY, FOCUSED_VIEW_IMAGE_KEY, type ViewImageKey, type CaptureReceipt } from "./capture.ts";

/** The read and its focused twin (a SessionWrite) answer the same image; the host keeps both as captures. */
export const isViewImage = (key: string): key is ViewImageKey =>
  key === VIEW_IMAGE_KEY || key === FOCUSED_VIEW_IMAGE_KEY;
export type NativeReadOutput<K extends HostOperationKey> = K extends ViewImageKey
  ? Omit<OpResponseOf<K>,"filePath"> & {capture:CaptureReceipt;imageUrl:string|null} : OpResponseOf<K>;
const viewImage=(key:ViewImageKey)=>{
  const entry=hostOpCatalog.find(op=>op.key === key)!;
  const json=JSON.parse(entry.responseSchemaJson);
  delete json.properties.filePath;
  json.required=json.required.filter((name:string)=>name !== "filePath");
  json.properties.capture=z.toJSONSchema(captureReceiptSchema);
  json.required.push("capture");
  return generatedJsonSchema(json);
};
const image=new Map<ViewImageKey,z.ZodType>();
/** The host owns asset delivery; the C# DTO remains the raw native execution contract. */
export const nativeOutputSchema=<K extends HostOperationKey>(key:K):z.ZodType<NativeReadOutput<K>> =>
  (isViewImage(key) ? image.get(key) ?? image.set(key, viewImage(key)).get(key)! : nativeResponseSchema(key)) as z.ZodType<NativeReadOutput<K>>;
export function nativeOutputAssets(key:string,value:unknown):string[] {
  if(!isViewImage(key)) return [];
  const result=captureReceiptSchema.parse((value as {capture:unknown}).capture);
  return [result.sha];
}

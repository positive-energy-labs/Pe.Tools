import { z } from "zod";
import { Effect, Schema } from "effect";
import { tsOnlyOperationSchemas, type TsOnlyOperationKey, type OpRequestOf, type OpResponseOf } from "@pe/host-contracts/operation-types";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/pe-api";
import { effectDecoder } from "@pe/host-contracts/decoders";
import { leaf } from "./reads/evaluator.ts";
import { listPods, resolvePodIdentity, listRuns, readMember, composeMember } from "./settings.ts";
import { runPods } from "./family-actions.ts";

// Host-only composition has no bridge callback. The catalog's SessionWrite applies only when
// composition receives an attached Revit context; that context cannot enter this input service.
const operations = {
  "pod.list": (raw:unknown) => {
    const input=Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.list"].request)(raw);
    return input.projection === "identity" ? runPods({},resolvePodIdentity(input.folder)) : runPods({},listPods());
  },
  "pod.member.read": (raw:unknown) => runPods({},readMember(Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.member.read"].request)(raw))),
  "pod.member.compose": (raw:unknown) => runPods({},composeMember(Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.member.compose"].request)(raw))),
  "pod.runs": (raw:unknown) => runPods({},listRuns(Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.runs"].request)(raw))),
};
export type LocalReadKey=keyof typeof operations;
type LocalOutput<K extends LocalReadKey> = K extends "pod.list" ? Extract<OpResponseOf<K>,{pods:unknown}> : OpResponseOf<K>;
export const localRead = <K extends LocalReadKey>(key:K) => {
  const contract=tsOnlyOperationSchemas[key];
  const operation=tsOnlyOperationCatalog.find(op=>op.key === key);
  if(operation?.intent !== "Read") throw Error(`Local input is not a catalog read: ${key}`);
  const input=effectDecoder(contract.request) as unknown as z.ZodType<OpRequestOf<K>>;
  const output=effectDecoder(contract.response) as unknown as z.ZodType<LocalOutput<K>>;
  return leaf(`local:${key}`,input,output);
};
export async function readLocal(key:string,args:unknown):Promise<unknown> {
  if(!Object.hasOwn(operations,key)) throw Error(`Unknown local input ${key}`);
  return operations[key as LocalReadKey](args);
}

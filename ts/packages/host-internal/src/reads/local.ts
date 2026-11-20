import type { z } from "zod";
import {
  builtinLocalSchemas,
  type OpRequestOf,
  type OpResponseOf,
} from "@pe/host-contracts/operation-types";
import { effectDecoder } from "@pe/host-contracts/decoders";
import { leaf } from "./door.ts";

export type LocalReadKey = "pod.list" | "pod.member.read" | "pod.member.compose" | "pod.runs";
type JsonData<T> = T extends readonly (infer U)[]
  ? JsonData<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: JsonData<T[K]> }
    : T;
type LocalOutput<K extends LocalReadKey> = JsonData<
  K extends "pod.list" ? Extract<OpResponseOf<K>, { pods: unknown }> : OpResponseOf<K>
>;
export const localRead = <K extends LocalReadKey>(key: K) => {
  const contract = builtinLocalSchemas[key];
  const input = effectDecoder(contract.request) as unknown as z.ZodType<OpRequestOf<K>>;
  const output = effectDecoder(contract.response) as unknown as z.ZodType<LocalOutput<K>>;
  return leaf(`local:${key}`, input, output);
};

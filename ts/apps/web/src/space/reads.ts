import { z } from "zod";
import type { DocumentRef } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  type OpRequestOf,
  type OpResponseOf,
} from "@pe/host-contracts/operation-types";
import { callOp } from "#/shell/readings-api";
import { NATIVE_READ_WAIT_S } from "#/route/waits";

const xyz = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const regionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("box"),
    box: z
      .tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
      .refine(
        (b) => b.every(Number.isFinite) && b[0] < b[3] && b[1] < b[4] && b[2] < b[5],
        "Box needs positive finite extents",
      ),
  }),
  z.object({ kind: z.literal("room"), uniqueId: z.string().min(1) }),
  z.object({ kind: z.literal("space"), uniqueId: z.string().min(1) }),
]);
export const spaceReads = {
  "revit.detail.space-scene": {
    input: z.object({
      region: regionSchema.optional(),
      elementIds: z.array(z.number().int().positive()),
      contextPaddingFt: z.number().nonnegative(),
      maxTriangles: z.number().int().positive(),
      focusOnly: z.boolean(),
      contextRepresentation: z.enum(["overview", "meshes"]),
    }),
  },
  "revit.detail.space-status": { input: z.object({}) },
  "revit.detail.space-rows": { input: z.object({ region: regionSchema }) },
  "revit.detail.space-tree": {
    input: z.object({
      region: regionSchema,
      source: z.number().int().nonnegative(),
      maxDepth: z.number().int().min(1).max(16),
    }),
  },
  "revit.detail.space-slice": {
    input: z
      .object({ region: regionSchema, z0: z.number().finite(), z1: z.number().finite() })
      .refine((v) => v.z1 > v.z0, "z1 must be above z0"),
  },
  "revit.detail.space-probe": { input: z.object({ region: regionSchema, at: xyz }) },
  "revit.detail.space-sweep": {
    input: z.object({
      region: regionSchema,
      polyline: z.array(xyz).min(2),
      widthFt: z.number().positive(),
      heightFt: z.number().positive(),
      clearanceFt: z.number().nonnegative(),
    }),
  },
} as const;
export type SpaceReadKey = keyof typeof spaceReads;
export type Answer<K extends SpaceReadKey> = { request: OpRequestOf<K>; response: OpResponseOf<K> };
export type SpaceAnswerKey = "status" | "rows" | "tree" | "slice" | "probe" | "sweep";
export type SpaceAnswers = { [K in SpaceAnswerKey]: Answer<`revit.detail.space-${K}`> | null };
export type SpaceReadResult<K extends SpaceReadKey = SpaceReadKey> = Answer<K> & {
  document: DocumentRef;
  notice?: string | null;
};

/** Invoked only by the kernel query door, with its resolved exact document. */
export async function readSpaceCapture<K extends SpaceReadKey>(
  key: K,
  input: unknown,
  document?: DocumentRef,
): Promise<SpaceReadResult<K>> {
  if (!document) throw Error("Choose an exact document before reading Space");
  const request = spaceReads[key].input.parse(input);
  const call = (request: OpRequestOf<K>) =>
    callOp(
      {
        signal: AbortSignal.timeout(NATIVE_READ_WAIT_S * 1000),
        headers: {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: document.session,
          [HOST_RPC_DOCUMENT_HEADER]: document.openId,
          [HOST_RPC_ORIGIN_HEADER]: "web:/space",
        },
      },
      key,
      request,
    );
  const response = await call(request as OpRequestOf<K>);
  return { request: request as OpRequestOf<K>, response, document };
}

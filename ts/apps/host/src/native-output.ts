import { readFile } from "node:fs/promises";
import { Effect, Layer } from "effect";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { captureReceiptSchema, nativeOutputSchema, type Caller } from "@pe/agent-contracts";
import { type PictureCaptures, PictureStoreFull } from "./captures-route.ts";
import { InvalidRead } from "@pe/host-internal/read-errors";
import { RequestIdentity } from "@pe/host-internal/request-identity";
import { callPolicies } from "../../../packages/agent-contracts/src/call-policy.ts";
import type { HostOperationKey, OpResponseOf } from "@pe/host-contracts/operation-types";

/** One operation-owned asset projection, before native recording and public response delivery. */
export const projectNativeOutput = (
  pictures: PictureCaptures,
  key: string,
  value: unknown,
  request: unknown,
  target: { openDocumentId?: string | null },
  caller: Caller,
  origin = "",
) =>
  Effect.tryPromise({
    try: async () => {
      if (callPolicies[key]?.capture !== true) return value;
      const captureKey = key as HostOperationKey;
      if (
        value &&
        typeof value === "object" &&
        "capture" in value &&
        captureReceiptSchema.safeParse(value.capture).success
      )
        return nativeOutputSchema(captureKey).parse(value);
      const raw = nativeResponseSchema(captureKey).parse(
        value,
      ) as OpResponseOf<"revit.context.view-image">;
      if (raw.refused) {
        const { filePath: _, ...body } = raw;
        return nativeOutputSchema(captureKey).parse({ ...body, capture: null, imageUrl: null });
      }
      if (!raw.filePath) throw Error("View image has no PNG path and no refusal reasons");
      const focus =
        (request as { focus?: import("@pe/agent-contracts").CaptureReceipt["focus"] } | null)
          ?.focus ?? null;
      const capture = await pictures.keep(await readFile(raw.filePath), {
        origin: /^(?:web|page):./.test(origin)
          ? origin
          : caller.kind === "human"
            ? "human"
            : "agent",
        document: { ...(target.openDocumentId ? { openId: target.openDocumentId } : {}) },
        view: {
          ...(raw.view.elementId != null ? { id: raw.view.elementId } : {}),
          ...(raw.view.label ? { name: raw.view.label } : {}),
        },
        focus,
        marks: raw.marks,
        registration: raw.registration ? { ...raw.registration } : null,
      });
      const { filePath: _, ...body } = raw;
      return nativeOutputSchema(captureKey).parse({
        ...body,
        capture,
        imageUrl: capture.url,
      });
    },
    catch: (error) =>
      new InvalidRead({
        message: String(error),
        status: error instanceof PictureStoreFull ? 409 : 502,
        problem: "native.asset",
      }),
  });
export const nativeOutputLayer = (pictures: PictureCaptures) =>
  Layer.effect(
    HostNativeRead,
    Effect.gen(function* () {
      const raw = yield* HostNativeRead;
      return {
        resolve: raw.resolve,
        read: (request) =>
          Effect.gen(function* () {
            const identity = yield* RequestIdentity;
            const answer = yield* raw.read(request);
            const value = yield* projectNativeOutput(
              pictures,
              request.key,
              answer.value,
              request.input,
              request.scope,
              identity.caller,
            );
            return { ...answer, value: JSON.parse(JSON.stringify(value)) };
          }),
      };
    }),
  );

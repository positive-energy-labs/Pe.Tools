import { readFile } from "node:fs/promises";
import { Effect, Layer } from "effect";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { captureReceiptSchema, nativeOutputSchema, type Caller } from "@pe/agent-contracts";
import { type PictureCaptures, PictureStoreFull } from "./captures-route.ts";
import { InvalidRead } from "./native-reads.ts";
import { RequestIdentity } from "./request-services.ts";

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
      if (key !== "revit.context.view-image") return value;
      if (
        value &&
        typeof value === "object" &&
        "capture" in value &&
        captureReceiptSchema.safeParse(value.capture).success
      )
        return nativeOutputSchema("revit.context.view-image").parse(value);
      const raw = nativeResponseSchema("revit.context.view-image").parse(value);
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
        registration: raw.registration ? { ...raw.registration } : null,
      });
      const { filePath: _, ...body } = raw;
      return nativeOutputSchema("revit.context.view-image").parse({
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

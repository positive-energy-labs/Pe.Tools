/** Process-local authenticated claims over sealed BODY consumptions, not a token registry. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Context, Effect, Schema } from "effect";
import type { RequestPrincipal } from "@pe/runtime/context";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { BODY_RECEIPT_HEADER, DUCTS_BODY_VERSION_HEADER } from "@pe/agent-contracts";
import { HttpServerResponse } from "effect/http";
import type { RecordingWriter } from "./native-recording.ts";
import { InvalidRead } from "./native-reads.ts";

export class BodyReceiptAudience extends Context.Service<BodyReceiptAudience, string | null>()(
  "pe/BodyReceiptAudience",
) {}
/** Only admission calls this, with its VALIDATED credential headers. Role alone is never audience. */
export const admittedBodyAudience = (
  principal: RequestPrincipal,
  headers: Readonly<Record<string, string | undefined>>,
) => {
  const credential = headers.cookie ?? headers[HOST_CONTEXT_HEADER];
  return credential
    ? createHash("sha256")
        .update(JSON.stringify([principal, credential]))
        .digest("hex")
    : null;
};
const claimSchema = Schema.Struct({
  r: Schema.String,
  v: Schema.NonEmptyString,
  b: Schema.String,
  c: Schema.String,
  p: Schema.String,
});
export type BodyClaim = typeof claimSchema.Type;
const refuse = () =>
  new InvalidRead({
    message: "Body receipt is missing, foreign or invalid",
    status: 409,
    problem: "recording.receipt",
  });

export const bodyReceipts = (writer: RecordingWriter) => {
  const key = randomBytes(32);
  const mac = (bytes: string) => createHmac("sha256", key).update(bytes).digest();
  const verify = Effect.fn("BodyReceipt.verify")(function* (
    receipt: string,
    audience: string | null,
  ) {
    if (!audience || receipt.length > 4096) return yield* refuse();
    const parts = receipt.split(".");
    if (parts.length !== 2) return yield* refuse();
    const signed = Buffer.from(parts[1]!, "base64url"),
      expected = mac(parts[0]!);
    if (signed.length !== expected.length || !timingSafeEqual(signed, expected))
      return yield* refuse();
    const claim = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(claimSchema))(
      Buffer.from(parts[0]!, "base64url").toString("utf8"),
    ).pipe(Effect.mapError(refuse));
    if (
      claim.p !== audience ||
      claim.b !== writer.identity.build ||
      claim.c !== writer.identity.catalog
    )
      return yield* refuse();
    const record = yield* writer.readSets.get(claim.r);
    if (record.state !== "complete") return yield* refuse();
    return claim;
  });
  const mint = Effect.fn("BodyReceipt.mint")(function* (
    readSet: string,
    version: string,
    audience: string | null,
  ) {
    if (!audience || writer.capture.truncated()) return undefined;
    const at = writer.capture.begin();
    if (at === null) return undefined;
    return yield* Effect.gen(function* () {
      const record = yield* writer.readSets.get(readSet);
      if (record.state !== "complete" || writer.capture.truncated()) return undefined;
      const bytes = Buffer.from(
        JSON.stringify({
          r: readSet,
          v: version,
          b: writer.identity.build,
          c: writer.identity.catalog,
          p: audience,
        }),
      ).toString("base64url");
      const receipt = `${bytes}.${mac(bytes).toString("base64url")}`;
      if (receipt.length > 4096) return yield* refuse();
      return receipt;
    }).pipe(
      Effect.catch((error) =>
        Effect.as(
          writer.capture.stop(at, error.problem === "recording.io" ? "io" : "unsupported"),
          undefined,
        ),
      ),
    );
  });
  return {
    verify,
    mint,
    attach: Effect.fn("BodyReceipt.attach")(function* (
      response: HttpServerResponse.HttpServerResponse,
      readSet: string,
      audience: string | null,
    ) {
      if (
        response.status < 200 ||
        response.status >= 300 ||
        writer.capture.truncated() ||
        !audience
      )
        return response;
      const text = yield* Effect.tryPromise({
        try: () => HttpServerResponse.toWeb(response).text(),
        catch: refuse,
      }).pipe(Effect.option);
      if (text._tag === "None") return response;
      const version =
        response.headers[DUCTS_BODY_VERSION_HEADER] ??
        createHash("sha256").update(text.value).digest("hex");
      const receipt = yield* mint(readSet, version, audience);
      return receipt
        ? HttpServerResponse.setHeader(response, BODY_RECEIPT_HEADER, receipt)
        : response;
    }),
  };
};

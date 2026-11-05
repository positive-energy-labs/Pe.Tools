/**
 * The session inventory a reading consumes (ADR 0031 rule 1): the canonical attachment behind an id,
 * the exact attachment a reading scope names, and the open-document row a Work key binds. Live,
 * it is the SDK session service and the bridge list under the caller's own policy. Recorded, it is
 * historical identity only: nothing here mints a current session, a bridge or an attachment.
 */
import { Context, Effect, Layer, Schema } from "effect";
import {
  addressSchema,
  documentRefSchema,
  type Address,
  type DocumentRef,
} from "@pe/agent-contracts";
import { BridgeError } from "@pe/host-internal/dispatch";
import { canonicalJson } from "@pe/host-internal/native-read";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import type { DoorFailure, RequestIdentity } from "@pe/host-internal/request-contracts";
import { RevitBridge } from "./bridge.ts";
import { InvalidRead } from "./native-reads.ts";
import {
  captureInput,
  replayInput,
  type RecordedInput,
  type RecordingReader,
  type RecordingWriter,
} from "./native-recording.ts";
import { SdkSession } from "./sdk-session.ts";

export interface DocumentRow {
  readonly session: string;
  readonly openId: string;
  readonly address: Address | null;
}
type Read<A> = Effect.Effect<A, DoorFailure, RequestIdentity>;
interface Inventory {
  /** The canonical bridge session behind an SDK alias or bridge id (`SdkSession.resolveAttachment`). */
  readonly attachment: (id: string) => Read<{ readonly sessionId: string }>;
  /** The exact attachment a reading scope names (`SdkSession.resolve`). */
  readonly session: (scope: HostSessionScope) => Read<{ readonly sessionId: string }>;
  /** The open-document row a sheet's Work key binds. */
  readonly document: (ref: DocumentRef) => Read<DocumentRow>;
}

const sessionCodec = Schema.Struct({ sessionId: Schema.String });
const documentRow = documentRefSchema.extend({ address: addressSchema.nullable() });
const rowCodec = Schema.declare((u): u is DocumentRow => documentRow.safeParse(u).success);
/** One selector's input and its fence: the selector with its exact arguments. */
const selector = (name: keyof Inventory, args: Schema.Json) => {
  const scope = canonicalJson([name, args]);
  return { input: { kind: "document", scope } satisfies RecordedInput, scope };
};

export class HostSessionInventory extends Context.Service<HostSessionInventory, Inventory>()(
  "pe/HostSessionInventory",
) {
  static readonly layer = Layer.effect(
    HostSessionInventory,
    Effect.gen(function* () {
      const sdk = yield* SdkSession;
      const bridge = yield* RevitBridge;
      return {
        attachment: (id) =>
          sdk.resolveAttachment({ id }).pipe(Effect.map(({ sessionId }) => ({ sessionId }))),
        session: (scope) => sdk.resolve(scope).pipe(Effect.map(({ sessionId }) => ({ sessionId }))),
        document: (ref) =>
          bridge.list.pipe(
            Effect.mapError(
              (error) => new BridgeError(String(error), 503, { notDispatched: true }),
            ),
            Effect.flatMap((sessions) => {
              const open = sessions
                .find((session) => session.connected && session.sessionId === ref.session)
                ?.state?.openDocuments?.find((document) => document.openId === ref.openId);
              return open
                ? Effect.succeed({
                    session: ref.session,
                    openId: ref.openId,
                    address: (open.address as Address | null | undefined) ?? null,
                  })
                : Effect.fail(
                    new InvalidRead({
                      message: "Sheet Work target is no longer open",
                      status: 409,
                      problem: "target.closed",
                    }),
                  );
            }),
          ),
      } satisfies Inventory;
    }),
  );
  /** The live inventory, each answer or refusal kept as a taking of that selector. */
  static readonly capturing = (writer: RecordingWriter) =>
    Layer.effect(
      HostSessionInventory,
      Effect.map(Effect.service(HostSessionInventory), (live) => {
        const keep = <A, I>(
          name: keyof Inventory,
          args: Schema.Json,
          codec: Schema.Codec<A, I>,
          read: Read<A>,
        ): Read<A> =>
          Effect.flatMap(Effect.context<RequestIdentity>(), (context) => {
            const { input, scope } = selector(name, args);
            return captureInput(writer, input, scope, codec, Effect.provide(read, context));
          });
        return {
          attachment: (id) => keep("attachment", id, sessionCodec, live.attachment(id)),
          session: (scope) => keep("session", scope, sessionCodec, live.session(scope)),
          document: (ref) => keep("document", ref, rowCodec, live.document(ref)),
        } satisfies Inventory;
      }),
    );
  /** Recorded inventory only: a miss refuses, and no SDK or bridge is built or read. */
  static readonly recorded = (reader: RecordingReader) => {
    const replay = <A, I>(name: keyof Inventory, args: Schema.Json, codec: Schema.Codec<A, I>) => {
      const { input, scope } = selector(name, args);
      return replayInput(reader, input, scope, codec);
    };
    return Layer.succeed(HostSessionInventory, {
      attachment: (id) => replay("attachment", id, sessionCodec),
      session: (scope) => replay("session", scope, sessionCodec),
      document: (ref) => replay("document", ref, rowCodec),
    } satisfies Inventory);
  };
}

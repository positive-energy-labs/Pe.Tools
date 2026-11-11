import { ownedSession } from "./callers.ts";
import { Effect, Queue } from "effect";
import { type HttpServerRequest } from "effect/http";
import { BRIDGE_CONTRACT_VERSION, type BridgeFrame, type BridgeStateSnapshot } from "@pe/host-contracts/contracts";
import { RevitBridge } from "../src/bridge.ts";
export const connectTestBridge = (processId = 42, ownership: Record<string, unknown> = {}, state: Partial<BridgeStateSnapshot> = {}) =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    // A string is one frame; an array is one socket batch, decoded frame by frame in one pull.
    const incoming = yield* Queue.make<string | readonly string[]>();
    const outgoing = yield* Queue.make<BridgeFrame>();
    // This substitutes only the socket. Registration, JSON frame decoding, response mailbox,
    // invokeSession, BridgeError and operation-owner classification are production code.
    const req = {
      upgrade: Effect.succeed({
        writer: Effect.succeed({
          write: (raw: string) => Queue.offer(outgoing, JSON.parse(raw)).pipe(Effect.asVoid),
        }),
        reader: Effect.succeed({
          pull: Queue.take(incoming).pipe(
            Effect.map((raw) => (typeof raw === "string" ? [raw] : raw)),
          ),
        }),
      }),
    } as unknown as HttpServerRequest.HttpServerRequest;
    const connection = yield* Effect.forkScoped(bridge.handleConnection(req));
    yield* Queue.offer(
      incoming,
      JSON.stringify({
        kind: "Registration",
        registration: {
          processId,
          processStartUtcUnixMs: 1000,
          sdkSessionId: "4242",
          contractVersion: BRIDGE_CONTRACT_VERSION,
          ...ownedSession,
          ...ownership,
          state: {
            activeDocumentIsFamilyDocument: false,
            activeDocumentIsModelInCloud: false,
            activeDocumentIsWorkshared: false,
            activeDocumentObservedAtUnixMs: 1,
            hasActiveDocument: true,
            activeDocumentPath: "C:/model.rvt",
            openDocuments: [
              {
                openId: "selected-open",
                title: "Selected",
                address: "C:/model.rvt",
                isActive: false,
                isFamilyDocument: false,
              },
              {
                openId: "other-open",
                title: "Active",
                address: "C:/other.rvt",
                isActive: true,
                isFamilyDocument: false,
              },
            ],
            revitVersion: "test",
            runtimeAssemblies: [],
            runtimeFramework: "test",
            ...state,
          },
        },
      }),
    );
    const ack = yield* Queue.take(outgoing);
    const target = { session: ack.registrationAck!.sessionId!, openId: "selected-open" };
    return { bridge, incoming, outgoing, connection, target, ack };
  });

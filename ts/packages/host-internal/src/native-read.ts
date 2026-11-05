import { Context, type Effect, type Schema } from "effect";
import type { HostSessionScope } from "../../host-contracts/src/operation-types.ts";
import type {
  DoorFailure,
  NativeAnswer,
  RequestIdentity,
  ResolvedReadDescriptor,
} from "./request-contracts.d.ts";

export interface NativeReadInput {
  readonly key: string;
  readonly input: unknown;
  readonly scope: HostSessionScope;
}

/** The one native Read admission (ADR 0029 rule 16): every call is admitted for its own caller,
 * then joins the shared native flight. Routes never mint a prepared read or supply a codec. */
export class HostNativeRead extends Context.Service<
  HostNativeRead,
  {
    readonly resolve: (
      request: NativeReadInput,
    ) => Effect.Effect<ResolvedReadDescriptor, DoorFailure, RequestIdentity>;
    readonly read: (
      request: NativeReadInput,
    ) => Effect.Effect<NativeAnswer<Schema.Json>, DoorFailure, RequestIdentity>;
  }
>()("pe/HostNativeRead") {}

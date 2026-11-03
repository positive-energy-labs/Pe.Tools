import { expectTypeOf, it } from "vite-plus/test";
import type {
  GeometryReadDoor,
  NativeReadDoor,
  NativeReadRefusal,
  NativeReadResult,
  ReadCost,
  ResolvedReadDescriptor,
} from "./native-read-door.ts";
import type { JournalSubmission, Observation, Unsubscribe } from "./work-journal-door.ts";
import type {
  GeometryOutcome,
  GeometryRequest,
  SceneContextRepresentation,
} from "./route-kernel-environment.ts";
import type { ScopeToken } from "./route-kernel-page.ts";

/** Never executed. tsc checks these boundaries with declarations enabled. */
export function nativeReadTypeRefusals(
  door: GeometryReadDoor<string>,
  request: GeometryRequest<SceneContextRepresentation>,
  scope: ScopeToken,
  descriptor: ResolvedReadDescriptor,
  value: GeometryOutcome<string>,
  cost: ReadCost,
  command: Pick<JournalSubmission, "lifetime">,
): void {
  const resolved: Observation<ResolvedReadDescriptor | NativeReadRefusal> = door.resolve(
    request,
    scope,
  );
  const joined: Observation<NativeReadResult<GeometryOutcome<string>>> = door.join(descriptor);
  const release: Unsubscribe = joined.subscribe(
    () => {},
    () => {},
  );
  const answer: NativeReadResult<GeometryOutcome<string>> = {
    kind: "value",
    value,
    descriptor,
    cost,
  };
  const attributed: NativeReadResult<GeometryOutcome<string>> = {
    kind: "value",
    value,
    descriptor,
    cost,
    // @ts-expect-error caller attribution is outside the shared answer
    caller: "human",
  };
  // @ts-expect-error an unresolved request is not a host descriptor
  door.join(request);
  // @ts-expect-error read lifetime cannot satisfy command lifetime, independently of methods
  command = door;
  // @ts-expect-error ReadCost is metadata, never a refusal failure
  const refusal: NativeReadResult<GeometryOutcome<string>> = { kind: "refused", failure: cost };
  // @ts-expect-error cost alone is not a refusal variant either
  const numericRefusal: NativeReadRefusal = cost;
  // @ts-expect-error callers must supply the host freshness token
  const unfenced: ResolvedReadDescriptor = { operationKey: "space-scene" };
  // @ts-expect-error D's nominal descriptor is not authored by this data contract
  const nominal: import("./route-kernel-environment.ts").ResolvedGeometryRead<string> = descriptor;
  void [resolved, release, answer, attributed, command, refusal, numericRefusal, unfenced, nominal];
}

it("binds geometry to the kernel types and exposes only read resolution/join", () => {
  expectTypeOf<GeometryReadDoor<string>>().toEqualTypeOf<
    NativeReadDoor<GeometryRequest<SceneContextRepresentation>, GeometryOutcome<string>>
  >();
  expectTypeOf<keyof NativeReadDoor<unknown, unknown>>().toEqualTypeOf<
    "lifetime" | "resolve" | "join"
  >();
  expectTypeOf<Extract<NativeReadResult<string>, { kind: "retiring" }>>().toEqualTypeOf<{
    readonly kind: "retiring";
  }>();
});

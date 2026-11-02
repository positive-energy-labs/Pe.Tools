import type { AcceptanceToken, IdentityId, Many, ScopeToken } from "./route-kernel-page.ts";

declare const nativeWrite: unique symbol;
declare const detailRequest: unique symbol;
export type NativeWriteCapability = { readonly [nativeWrite]: true };
export type ExplicitDetailRequest = {
  readonly [detailRequest]: true;
  readonly token: AcceptanceToken;
};
/** Geometry all always resolves to overview. Detailed requests need a narrow subject;
 * family-document is the explicit whole-document exception. Host estimates representation-
 * weighted cost before tessellation and owns read priority and cancellation. */
export type GeometryScope =
  | {
      readonly kind: "subjects";
      readonly ids: readonly [IdentityId<"element">, ...IdentityId<"element">[]];
    }
  | { readonly kind: "region"; readonly id: IdentityId<"local"> }
  | { readonly kind: "family-document"; readonly id: IdentityId<"document"> };
export type GeometryRequest =
  | {
      readonly representation: "overview";
      readonly subjects: Many<IdentityId<"element">>;
      readonly scope: ScopeToken;
    }
  | {
      readonly representation: "detailed";
      readonly subject: GeometryScope;
      readonly explicit: ExplicitDetailRequest;
      readonly budget: "host-weighted";
    };
export type GeometryOutcome<T> =
  | {
      readonly kind: "ready";
      readonly value: T;
      readonly representation: "overview" | "detailed";
      readonly cost: number;
    }
  | {
      readonly kind: "over-budget";
      readonly estimatedCost: number;
      readonly budget: number;
      readonly overviewEntry: string;
    }
  | { readonly kind: "unavailable" | "cancelled"; readonly reason: string };
/** D supplies scoped Effect services at composition. Type parameters retain those service
 * interfaces without importing Effect/React into the contract kernel or inventing Promise
 * adapters. No mode discriminator is passed to readings, commands or reducers. */
export interface RouteEnvironment<Reads, Work, Clock, Geometry> {
  readonly reads: Reads;
  readonly work: Work;
  readonly clock: Clock;
  readonly geometry: Geometry;
  readonly availability: Readonly<
    Record<string, { readonly available: boolean; readonly reason?: string }>
  >;
  readonly nativeWrite?: NativeWriteCapability;
}
/** Composition must omit native writes and provide isolated Work and seed-backed reads.
 * A missing seed is unavailable; it can never fall through to a native transport. */
export type FixtureEnvironment<R, W, C, G> = Omit<RouteEnvironment<R, W, C, G>, "nativeWrite"> & {
  readonly nativeWrite?: never;
};
export interface NativeWriteRequest {
  readonly capability: NativeWriteCapability;
  readonly token: AcceptanceToken;
  readonly entry: string;
}

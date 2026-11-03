import type { RouteGraphJson } from "./route-kernel-data.ts";
import type { SchemaTable } from "./route-kernel-page.ts";

export const workOwnerBinding: unique symbol = Symbol("Work owner schemas");
export interface WorkOwnerSource {
  readonly data: RouteGraphJson;
  readonly schemas: SchemaTable;
}
/** Import the owner's neutral exports. Symbol metadata keeps Page schema names local,
 * and carries the same owner source to both authoring types and admission. */
export function withWorkOwner<S extends SchemaTable, const O extends WorkOwnerSource>(
  schemas: S,
  owner: O & { readonly data: { readonly work: { readonly schema: string } } },
): S & { readonly [workOwnerBinding]: O } {
  return Object.freeze({ ...schemas, [workOwnerBinding]: Object.freeze({ ...owner }) });
}
export type WorkSchema<G extends RouteGraphJson, S extends SchemaTable> = G extends {
  work: { schema: infer K };
}
  ? S[Extract<K, keyof S>]
  : S extends { readonly [workOwnerBinding]: infer O extends WorkOwnerSource }
    ? G extends { work: { route: O["data"]["key"] } }
      ? O["data"] extends { work: { schema: infer K } }
        ? O["schemas"][Extract<K, keyof O["schemas"]>]
        : never
      : never
    : RouteGraphJson extends G
      ? S[Extract<NonNullable<G["work"]>["schema"], keyof S>]
      : never;

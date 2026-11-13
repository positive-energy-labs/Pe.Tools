/** Internal brand mints. Package exports expose the types through kinds, never these constructors. */
declare const where: unique symbol;
export type HomePath = string & { readonly [where]: "home" };
export type StatePath = string & { readonly [where]: "state" };
export const mintHomePath = (path: string): HomePath => path as HomePath;
export const mintStatePath = (path: string): StatePath => path as StatePath;

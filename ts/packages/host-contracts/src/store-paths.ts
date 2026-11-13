/** Internal brand mints. Package exports expose the types through kinds, never these constructors. */
declare const where: unique symbol;
export type HomePath = string & { readonly [where]: "home" };
export type StatePath = string & { readonly [where]: "state" };
/** The only HomePath brand mint; relocated from kinds.ts, never a new escape. */
export const mintHomePath = (path: string): HomePath => path as HomePath;
/** The only StatePath brand mint; all state tables and kinds call this mint. */
export const mintStatePath = (path: string): StatePath => path as StatePath;

/** Internal brand mints. Package exports expose the types through kinds, never these constructors. */
import { z } from "zod";
const homePathBrand = Symbol("home-path");
const statePathBrand = Symbol("state-path");
const homePathSchema = z.string().brand<typeof homePathBrand>();
const statePathSchema = z.string().brand<typeof statePathBrand>();
export type HomePath = z.infer<typeof homePathSchema>;
export type StatePath = z.infer<typeof statePathSchema>;
/** The only HomePath brand mint; the private schema validates the path string. */
export const mintHomePath = (path: string): HomePath => homePathSchema.parse(path);
/** The only StatePath brand mint; all state tables and kinds use this private schema. */
export const mintStatePath = (path: string): StatePath => statePathSchema.parse(path);

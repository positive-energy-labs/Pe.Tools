import { commandTable } from "./generated/command-axes.generated.ts";
export { commandTable, commandCatalogAxes } from "./generated/command-axes.generated.ts";
export type CommandKey = keyof typeof commandTable;
export type CommandEffect<K extends CommandKey> = (typeof commandTable)[K]["effect"];

import { z } from "zod";
import { commands } from "@pe/agent-contracts/semantic-actions";
import { commandCatalogAxes } from "@pe/agent-contracts/command-axes";

type ResultCommand = {
  [K in keyof typeof commands]: (typeof commands)[K] extends { result: z.ZodType } ? K : never;
}[keyof typeof commands];
export const commandContract = <K extends keyof typeof commands & keyof typeof commandCatalogAxes>(key:K) => {
  const declaration=commands[key];
  return {input:declaration.input,output:"result" in declaration?declaration.result:z.unknown(),axes:commandCatalogAxes[key]};
};
type WriteCommand = {
  [K in keyof typeof commands]: (typeof commands)[K] extends { writeBoundary: { phase: "apply" } }
    ? K
    : never;
}[keyof typeof commands];
export const command = <K extends WriteCommand & keyof typeof commandCatalogAxes>(key: K) => {
  const plan = commands[key].writeBoundary.previewKey;
  if (!Object.hasOwn(commands, plan) || !Object.hasOwn(commandCatalogAxes, plan))
    throw Error(`Missing plan contract for ${key}`);
  return {
    entry: key,
    plan,
    contract: commandContract(key),
    planContract: commandContract(plan as ResultCommand & keyof typeof commandCatalogAxes),
  };
};
type SessionCommandKey = { [K in keyof typeof commandCatalogAxes]:
  "SessionWrite" extends (typeof commandCatalogAxes)[K]["effect"] ? K : never }[keyof typeof commandCatalogAxes];
export const sessionCommand = <K extends SessionCommandKey & keyof typeof commands>(key: K) => {
  if(commandCatalogAxes[key].effect !== "SessionWrite") throw Error("Session commands require a SessionWrite contract");
  return {kind:"session" as const,entry:key,contract:commandContract(key)};
};
type DirectCommandKey = { [K in keyof typeof commandCatalogAxes]:
  (typeof commandCatalogAxes)[K]["effect"] extends "Read"|"SessionWrite" ? K : never }[keyof typeof commandCatalogAxes];
export const catalogAction = <K extends DirectCommandKey & keyof typeof commands>(key:K) => {
  if(!["Read","SessionWrite"].includes(commandCatalogAxes[key].effect) || "writeBoundary" in commands[key])
    throw Error("Direct catalog actions cannot cross a model write boundary");
  return {kind:"catalog" as const,entry:key,contract:commandContract(key)};
};
const directAction = <R extends z.ZodType>(kind:"query"|"rpc",entry:import("@pe/agent-contracts").ReadEntry<R>) => ({
  kind,entry:entry.key,contract:{input:entry.input,output:z.unknown(),axes:{subject:"Document",touches:["Metadata"],
    effect:kind === "query"?"Read":"SessionWrite",cost:"Cheap",cardinality:"One"} as const},invoke:entry.run,
});
export const queryAction = <R extends z.ZodType>(entry:import("@pe/agent-contracts").ReadEntry<R>) => directAction("query",entry);
export const rpcAction = <R extends z.ZodType>(entry:import("@pe/agent-contracts").ReadEntry<R>) => directAction("rpc",entry);

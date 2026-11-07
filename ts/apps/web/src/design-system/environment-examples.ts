import type {Reading} from "@pe/agent-contracts";
import {CHAT_SEEDS, CHAT_SEED_THREAD_WORK} from "./chat-examples";
import {openSeeds} from "../open/graph-seeds";
export function environmentExample(name:string, slot:string):Reading<unknown> {
  if(slot === "machine") {
    const seed=openSeeds[name];
    return seed ? {state:"ready",observation:seed.readings.machine} : {state:"failed",message:`Unknown fixture: ${name}`};
  }
  const key=typeof location !== "undefined" && location.pathname !== "/pea" ? "attach" : name;
  const seed=CHAT_SEEDS[key as keyof typeof CHAT_SEEDS];
  if(!seed) return {state:"failed",message:`Unknown fixture: ${name}`};
  const value=slot === "transcript" ? seed.work : slot === "threadWork" ? CHAT_SEED_THREAD_WORK : seed.readings[slot as keyof typeof seed.readings];
  return value === undefined ? {state:"absent"} : {state:"ready",observation:value};
}

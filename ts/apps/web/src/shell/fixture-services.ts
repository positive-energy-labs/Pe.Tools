/** Shared chrome consumes the same data maps the route graphs declare. No transport lives here. */
import type { Machine, Reading, HarnessThreadBody, ThreadWorkSnapshot } from "@pe/agent-contracts";
import type { BAY_RECENTS } from "#/open/seeds";
import { openSeeds } from "#/open/graph-seeds";
import { chatSeeds } from "#/chat/graph-seeds";
import { useRouteSearchSlice } from "#/route/activity";
import { fixtureName } from "./fixture-lane";
export const useFixtureName = () => useRouteSearchSlice(fixtureName);
export const fixtureMachine = (name: string): Reading<Machine> => {
  const value = (openSeeds[name as keyof typeof openSeeds] ?? openSeeds.refresh).readings.machine;
  return value ? { state: "ready", observation: value as Machine } : { state: "absent" };
};
export const fixtureRecents = (name: string) =>
  (openSeeds[name as keyof typeof openSeeds] ?? openSeeds.refresh).readings
    .recents as typeof BAY_RECENTS;
export const fixtureThread = (name: string) =>
  (chatSeeds[name] ?? chatSeeds.send)!.readings.transcript as HarnessThreadBody;
export const fixtureThreadWork = (name: string) =>
  (chatSeeds[name] ?? chatSeeds.send)!.readings.threadWork as ThreadWorkSnapshot;

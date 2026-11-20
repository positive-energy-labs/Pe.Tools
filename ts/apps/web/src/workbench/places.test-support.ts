import { afterEach, vi } from "vite-plus/test";
import { Places, places } from "./places";
import type { ThreadTab } from "@pe/agent-contracts";
import type { peClient } from "#/host/pe-client";
import type { Readings } from "#/host/resource-stream";

export function hostList() {
  let tabs: ThreadTab[] = [];
  const followers = new Set<Parameters<Readings["subscribe"]>[1]>();
  const emit = () =>
    followers.forEach((accept) =>
      accept({ kind: "snapshot", key: "places", value: { state: "refresh-needed" } }),
    );
  const client = {
    call: async (door: string, input: any) => {
      if (door === "places.put") {
        tabs = input.body.places;
        emit();
        return { places: tabs };
      }
      return { value: { data: { places: tabs } } };
    },
  } as typeof peClient;
  const stream: Readings = {
    subscribe: (_request, accept) => {
      followers.add(accept);
      accept({ kind: "snapshot", key: "places", value: { state: "absent" } });
      return () => {
        followers.delete(accept);
      };
    },
    dirty: () => {},
  };
  return {
    client,
    stream,
    read: () => tabs,
    seed: (next: ThreadTab[]) => {
      tabs = next;
      emit();
    },
  };
}
export const host = hostList();
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});
export async function seedPlaces(tabs: ThreadTab[]) {
  stop?.();
  host.seed(tabs);
  const window = new Places(host.client, host.stream);
  vi.spyOn(places, "read").mockImplementation(window.read);
  vi.spyOn(places, "subscribe").mockImplementation(window.subscribe);
  vi.spyOn(places, "save").mockImplementation(window.save.bind(window));
  stop = window.subscribe(() => {});
  await Promise.resolve();
}

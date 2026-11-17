import { CHAT_SEEDS } from "../design-system/chat-examples.ts";

/** The same context the fixture workbench uses, published through the ordinary Value decoder. */
export const contextFixtures = Object.fromEntries(Object.entries(CHAT_SEEDS).map(([name, seed]) => [name, () => ({
  data: { machine: seed.readings.machine, capabilities: seed.readings.capabilities },
  coverage: { requested: [], covered: [], refused: [], unknown: [] },
})]));

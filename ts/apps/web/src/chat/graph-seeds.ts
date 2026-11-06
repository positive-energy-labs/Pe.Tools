import { CHAT_SEEDS, CHAT_SEED_THREAD_WORK } from "./seeds.ts";
export const chatSeeds = Object.fromEntries(
  Object.entries(CHAT_SEEDS).map(([name, seed]) => [
    name,
    {
      title: seed.title,
      page: seed.page,
      readings: { threads: [{ id: name, title: seed.title }], ...seed.readings, transcript: seed.work, threadWork: CHAT_SEED_THREAD_WORK },
    },
  ]),
);

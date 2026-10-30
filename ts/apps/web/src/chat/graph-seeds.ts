import { CHAT_SEEDS, CHAT_SEED_THREAD_WORK } from "./seeds";
export const chatSeeds = Object.fromEntries(
  Object.entries(CHAT_SEEDS).map(([name, seed]) => [
    name,
    {
      title: seed.title,
      page: seed.page,
      readings: { ...seed.readings, transcript: seed.work, threadWork: CHAT_SEED_THREAD_WORK },
    },
  ]),
);

import { z } from "zod";
import { readTable } from "../../../../packages/mcps/src/shared/query-client";
import { dirty, readReading } from "#/readings";
export const roomsQueries = readTable(
  { "rooms.refresh": { input: z.object({}) } },
  async (_, __, context) => {
    if (context.work) {
      const request = { kind: "work" as const, ...context.work.key };
      dirty(request);
      await readReading(request);
    }
    return null;
  },
);

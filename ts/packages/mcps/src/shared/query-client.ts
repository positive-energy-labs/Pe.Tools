import { familyReads, scheduleReads, type ReadEntry } from "@pe/agent-contracts";
import type { z } from "zod";
import { readFamilyCapture } from "./takeoff-action-client.ts";
import { readScheduleCapture } from "./schedule-client.ts";
import { familiesReads, readFamiliesCapture } from "./families-client.ts";

export function readTable<T extends Record<string, { input: z.ZodType }>>(
  declarations: T,
  run: (
    key: keyof T & string,
    input: z.output<T[keyof T]["input"]>,
    context: Parameters<ReadEntry["run"]>[1],
  ) => Promise<unknown>,
): { [K in keyof T]: ReadEntry<T[K]["input"]> } {
  return Object.fromEntries(
    Object.entries(declarations).map(([key, entry]) => [
      key,
      {
        key,
        input: entry.input,
        run: (input: unknown, context: Parameters<ReadEntry["run"]>[1]) =>
          run(key, input as z.output<T[keyof T]["input"]>, context),
      },
    ]),
  ) as { [K in keyof T]: ReadEntry<T[K]["input"]> };
}
const document = (context: Parameters<ReadEntry["run"]>[1]) =>
  context.target.kind === "document" ? context.target.ref : undefined;
const work = (context: Parameters<ReadEntry["run"]>[1]) => {
  if (!context.work) throw Error("Work has not been read yet");
  return context.work.key;
};
export const scheduleQueries = readTable(scheduleReads, (key, input, ctx) =>
  readScheduleCapture(key, input, document(ctx)),
);
export const familyQueries = readTable(familyReads, (key, input, ctx) =>
  readFamilyCapture(key, input, work(ctx), document(ctx)),
);
export const familiesQueries = readTable(familiesReads, (key, input, ctx) =>
  readFamiliesCapture(key, input, work(ctx), document(ctx)),
);

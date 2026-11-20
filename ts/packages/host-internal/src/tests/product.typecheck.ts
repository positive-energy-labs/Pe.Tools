// Compiled by this package's `check`, never run: every `@ts-expect-error` is a declaration `tsc` must refuse.
import { z } from "zod";
import type { ReadHandle } from "@pe/agent-contracts/handle";
import { product } from "@pe/agent-contracts/product";
import { implement, type CommandBody } from "../product.ts";

declare const roster: ReadHandle<"tiny.roster", { name: string }, number>;
declare const calc: ReadHandle<"tiny.calc", { id: number }, string>;
declare const executor: CommandBody;
const command = {
  says: "",
  input: z.object({}),
  needs: "nothing",
  effect: "query",
  dirties: [],
  native: [],
  writes: {},
} as const;
const tiny = product({
  id: "tiny",
  says: "Tiny",
  homes: {},
  cells: {},
  works: {},
  readings: { roster: { handle: roster, sources: [] }, calc: { handle: calc, sources: [] } },
  commands: { "tiny.write": command, "tiny.draw": command },
  routes: {},
});
const readings = {
  roster: (_ctx: unknown, args: { name: string }) => args.name.length,
  calc: (_ctx: unknown, args: { id: number }) => String(args.id),
};
const commands = { "tiny.write": executor, "tiny.draw": executor };
implement(tiny, { readings, commands });

// @ts-expect-error a declared reading with no host body
implement(tiny, { readings: { roster: readings.roster }, commands });
// @ts-expect-error a host reading the product does not declare, even through a spread
implement(tiny, { readings: { ...readings, extra: readings.calc }, commands });
// @ts-expect-error a declared command with no host body
implement(tiny, { readings, commands: { "tiny.write": executor } });
// @ts-expect-error a host command the product does not declare
implement(tiny, { readings, commands: { ...commands, "tiny.merge": executor } });
// @ts-expect-error a body that answers with the wrong data
implement(tiny, { readings: { ...readings, calc: readings.roster }, commands });

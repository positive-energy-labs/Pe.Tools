import { z } from "zod";
import type { Command } from "./command.ts";
import { workWriteCommands } from "./write-intent.ts";

const command = <I extends z.ZodType>(input: I) =>
  ({
    says: "x",
    dirties: [],
    needs: "nothing",
    effect: "command",
    input,
    result: z.object({}),
  }) as const satisfies Command;

export function previewInputTypecheck() {
  const apply = command(z.strictObject({ a: z.string() }));
  workWriteCommands("r", "k", apply, {
    preview: { key: "p", definition: command(z.strictObject({ a: z.string() })) },
  });
  workWriteCommands("r", "k", apply, {
    // @ts-expect-error a narrower preview input than the apply's
    preview: { key: "p", definition: command(z.strictObject({})) },
  });
  workWriteCommands("r", "k", apply, {
    // @ts-expect-error a wider preview input than the apply's
    preview: { key: "p", definition: command(z.strictObject({ a: z.string(), b: z.number() })) },
  });
}

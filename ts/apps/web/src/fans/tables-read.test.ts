import { expect, test, vi } from "vite-plus/test";
import { nativeRequestSchema } from "@pe/host-contracts/decoders";
import { TABLE_IDS } from "@pe/ducts-domain/pricing";
import { entries, fansNeutralBodies } from "./neutral.ts";
import { createWitness } from "./cutover.test-support.ts";

test("Fans requests the shared native tables input and can price the result", async () => {
  const context: Parameters<typeof fansNeutralBodies.tablesArgs.run>[0] = { page: {}, work: {}, readings: {} };
  const input = entries["ducts.tables"].input.parse(fansNeutralBodies.tablesArgs.run(context));
  expect(input).toEqual({ ids: TABLE_IDS });
  expect(nativeRequestSchema("ducts.tables").parse(input)).toEqual(input);
  const closes: (() => void)[] = [];
  const received: unknown[] = [];
  try {
    const f = await createWitness(closes, new Map(), {
      "ducts.tables": {
        kind: "use",
        open(ctx, deliver) {
          received.push(nativeRequestSchema("ducts.tables").parse(ctx.args));
          deliver({ kind: "complete", value: {}, revision: 1 });
        },
      },
    });
    await vi.waitFor(() => expect(f.fans.readingStatus("tables").snapshot.current).toBe(true));
    expect(received).toContainEqual({ ids: TABLE_IDS });
    f.fans.refresh("pricing");
    await vi.waitFor(() => expect(f.fans.readingStatus("pricing").snapshot).toMatchObject({
      current: true,
      value: { priced: { next: { paths: expect.any(Object) } } },
    }));
  } finally {
    closes.reverse().forEach((close) => close());
  }
});

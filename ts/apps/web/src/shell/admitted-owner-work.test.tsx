// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { JOIN_KEY } from "@pe/ducts-domain/sheet/inputs";
import { isValidElement } from "react";
import type { FansDrawContext } from "../fans/route.ts";
import { createWitness } from "../fans/cutover.test-support.ts";

const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

// The owner revision and inverse belong to the mount, independent of the pane or client.
test("a rendered foreign cell keeps its owner, label and undo, and refuses a concurrent edit", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("owner:ducts").snapshot.current).toBe(true));
  await vi.waitFor(() => expect(f.fans.readingStatus("value").snapshot.current).toBe(true));
  const draw = () => {
    const body = f.fans.read("sheet-ledger");
    if (!isValidElement<{ ctx: FansDrawContext }>(body)) throw Error("Ledger did not render");
    return body.props.ctx;
  };
  const cells = draw().cells;
  expect(cells.owner(["assumptions"])).toEqual({ route: "ducts", label: "from /ducts" });
  const pair: [string, string] = ["10:1", "30:1"];
  const before = f.fans.work()?.revision;
  const [first, late] = await Promise.all([
    cells
      .at(["assumptions", JOIN_KEY(pair)], "ducts")
      .stage({ kind: "verdict", verdict: "connect" }, { label: "Accept join" }),
    cells.edit({ joins: [{ pair, verdict: "accept" }] }, { label: "Accept join" }),
  ]);
  expect(first).toBeNull();
  expect(late).toMatchObject({ code: "refused" });
  await vi.waitFor(() =>
    expect(f.owner.work()?.value).toHaveProperty(
      ["assumptions", JOIN_KEY(pair), "edit", "value", "verdict"],
      "connect",
    ),
  );
  expect(f.fans.work()?.revision).toBe(before);
  expect(f.owner.journal()?.receipts[0]?.patches[0]?.path).toEqual([
    "assumptions",
    JOIN_KEY(pair),
  ]);
  await vi.waitFor(() =>
    expect(draw().cells.history.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Accept join \u00b7 from /ducts" }),
      ]),
    ),
  );
  expect(await draw().cells.history.undo()).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(f.owner.work()?.value).toHaveProperty("assumptions", {}));
  expect(await draw().cells.history.redo()).toMatchObject({ ok: true });
  await vi.waitFor(() =>
    expect(f.owner.work()?.value).toHaveProperty(
      ["assumptions", JOIN_KEY(pair), "edit", "value", "verdict"],
      "connect",
    ),
  );
  expect(await cells.edit({ joins: [{ pair, verdict: "accept" }] })).toMatchObject({
    code: "refused",
  });
});

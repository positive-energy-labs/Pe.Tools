import { expect, test, vi } from "vite-plus/test";

const client = vi.hoisted(() => ({
  read: vi.fn(),
  run: vi.fn(),
  result: vi.fn(),
}));

vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  readFamilyCapture: client.read,
  runSemanticAction: client.run,
  actionResult: client.result,
}));

import { manifest } from "#/parameter-links/manifest";

const target = { session: "session-1", openId: "document-1" };
const key = { route: "parameter-links", target: "model.rvt" as const };
const ctx = {
  target: { kind: "document" as const, ref: target },
  work: { key, doc: { draft: {} }, revision: 7 },
  readings: {},
  page: { view: "links" as const },
  external: <A>(run: () => Promise<A>) => run(),
};

test("canonical Parameter Links actions preserve evaluation and reviewed apply identity", async () => {
  client.run.mockResolvedValue({ ok: true });

  await manifest.actions?.refresh.run(ctx as never, undefined as never);
  await manifest.actions?.preview.run(ctx as never, undefined as never);
  await manifest.actions?.apply.run(ctx as never, { readingId: "reading-7" } as never);

  expect(client.read).toHaveBeenNthCalledWith(
    1,
    "parameter-links.read",
    { evaluate: false },
    key,
    target,
  );
  expect(client.read).toHaveBeenNthCalledWith(
    2,
    "parameter-links.read",
    { evaluate: true },
    key,
    target,
  );
  expect(client.run).toHaveBeenCalledWith(
    "parameter-links.apply",
    { readingId: "reading-7" },
    target,
    { work: { key, revision: 7 } },
    "human",
  );
  expect(client.result).toHaveBeenCalledWith({ ok: true });
});

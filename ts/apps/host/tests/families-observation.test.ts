import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { captureStore } from "./effect-test.ts";
import { familiesRecorded } from "./families-recorded.fixture.ts";

test("real Families admission retains its recorded observation across store reconstruction and refuses a foreign lifetime", async () => {
  const f = await familiesRecorded(); const id = crypto.randomUUID();
  try {
    expect((await f.read(id)).status).toBeLessThan(400);
    const result = await f.native.journal.wait(id);
    expect(result, JSON.stringify(result)).toMatchObject({ state: "succeeded" });
    if (result.state !== "succeeded") throw Error(JSON.stringify(result));
    const retained = await captureStore(join(f.dir, "captures")).latestFamilies(f.key);
    expect(retained).toMatchObject({ id: (result.result as any).id });
    const before = f.native.calls.length;
    const response = await f.post({ id: "foreign", key: "families.read", target: { kind: "document", ref: { ...f.socket.target, openId: "other-open" } }, input: {
      work: { key: f.key, revision: 2 }, readId: crypto.randomUUID(),
    } });
    expect(response.status).toBeLessThan(400);
    expect(await f.native.journal.wait("foreign")).toMatchObject({ state: "failed", notDispatched: true, error: expect.stringContaining("another document") });
    expect(f.native.calls).toHaveLength(before);
    expect((await captureStore(join(f.dir, "captures")).latestFamilies(f.key))!.id).toBe(retained!.id);
  } finally { await f.close(); }
});

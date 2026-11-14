import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, test } from "vite-plus/test";
import {
  circuitReduce,
  initialCircuitState,
} from "../../../../examples/pods/snowdon-circuits/pages/tour/circuits.mjs";

// W45 review F-W45-8: a durable override names its circuit, so a reopened copy replays it onto the same one.
test("Snowdon circuit overrides replay against the same circuit", async () => {
  const client = await readFile(new URL("../src/pages/pe.js", import.meta.url), "utf8");
  const shared = client.slice(
    client.indexOf("/*pe:offline-state:start*/"),
    client.indexOf("/*pe:offline-state:end*/"),
  );
  const install = runInNewContext("(()=>{" + shared + ";return installPageState;})()", {
    console,
    Date,
  });
  const adapter = await readFile(
    new URL("../../../../examples/pods/snowdon-circuits/pages/tour/page.js", import.meta.url),
    "utf8",
  );
  const local = runInNewContext(/local:\s*(\[[^\]]*\])/.exec(adapter)![1]!);
  const rows: any[] = [];
  const io = {
    load: async (after = 0) => ({ seq: rows.length, events: rows.filter((r) => r.seq > after) }),
    append: async (event: any) => {
      rows.push({ seq: rows.length + 1, origin: "page", event, at: "now" });
    },
    publish: async () => {},
    follow: () => {},
  };
  const live: any = {};
  install(live, io);
  const options = { reduce: circuitReduce, base: structuredClone(initialCircuitState), local };
  const current = await live.state(options);
  await current.fire({
    v: 1,
    type: "reading",
    reading: { document: { session: "s", openId: "A" }, rows: [{ id: 91 }] },
  });
  await current.fire({ v: 1, type: "select", id: 91 });
  await current.fire({ v: 1, type: "override", id: 91, key: "length", value: "200" });
  const reopened: any = {};
  install(reopened, io);
  const replay = await reopened.state({ ...options, base: structuredClone(initialCircuitState) });
  expect(replay.state.overrides).toEqual(current.state.overrides);
});

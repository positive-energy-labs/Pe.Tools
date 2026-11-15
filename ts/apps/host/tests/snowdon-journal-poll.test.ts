// Review of fa689643: the Snowdon ducts journal poll speaks its contract and never appends a row twice.
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, test } from "vite-plus/test";
import { validateNativeInput } from "../src/native-input.ts";
test("Snowdon journal polls use native input fields and the last returned row", async () => {
  const html = await readFile(
    new URL("../../../../examples/pods/snowdon-ducts/pages/tour/index.html", import.meta.url),
    "utf8",
  );
  const source = html.slice(
    html.indexOf("  // One poll at a time"),
    html.indexOf("  pe.target().catch"),
  );
  let tick: () => Promise<void> = async () => {};
  const requests: any[] = [];
  let seq = 0;
  const state = { journal: [] as string[] };
  const error = { textContent: "" };
  runInNewContext(source, {
    pe: {
      doc: {},
      read: async (key: string, input: any) => {
        requests.push(input);
        validateNativeInput(key, input);
        return { rows: [{ line: ++seq, text: "row" + seq }] };
      },
    },
    k: {
      state,
      fire: async (event: any) => {
        state.journal = event.lines;
      },
    },
    $: () => error,
    setInterval: (f: any) => {
      tick = f;
    },
  });
  await tick();
  await tick();
  expect(requests).toEqual([{ maxLines: 20 }, { afterLine: 1, maxLines: 20 }]);
  expect(state.journal).toEqual(["row1", "row2"]);
  expect(error.textContent).toBe("");
});
test("overlapping journal ticks do not append the same rows twice", async () => {
  const html = await readFile(
    new URL("../../../../examples/pods/snowdon-ducts/pages/tour/index.html", import.meta.url),
    "utf8",
  );
  const source = html.slice(
    html.indexOf("  // One poll at a time"),
    html.indexOf("  pe.target().catch"),
  );
  let tick: () => Promise<void> = async () => {};
  const pending: ((value: any) => void)[] = [];
  const requests: any[] = [];
  const state = { journal: [] as string[] };
  runInNewContext(source, {
    pe: {
      doc: {},
      read: async (key: string, input: any) => {
        requests.push(input);
        validateNativeInput(key, input);
        return new Promise((ok) => pending.push(ok));
      },
    },
    k: {
      state,
      fire: async (event: any) => {
        state.journal = event.lines;
      },
    },
    $: () => ({ textContent: "" }),
    setInterval: (f: any) => {
      tick = f;
    },
  });
  const first = tick(),
    second = tick();
  // Both requests were made before either body completed. Let the first update settle before the second body.
  pending[0]?.({ rows: [{ line: 1, text: "row1" }] });
  await first;
  pending[1]?.({ rows: [{ line: 1, text: "row1" }] });
  await second;
  expect(state.journal).toEqual(["row1"]);
});

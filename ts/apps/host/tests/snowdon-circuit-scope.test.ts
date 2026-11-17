import { expect, test } from "vite-plus/test";
import { createInstruments } from "../../../../examples/pods/snowdon-circuits/pages/tour/instruments.mjs";
import { initialCircuitState } from "../../../../examples/pods/snowdon-circuits/pages/tour/circuits.mjs";

function calcBreakdown(refusal?: string) {
  const slots: any[] = [];
  let cursor = 0;
  const calls: any[] = [];
  const target = { session: "test", openId: "copy", title: "Chadds copy" };
  const React = {
    createElement: (type: any, props: any, ...children: any[]) => ({
      type,
      props: props || {},
      children: children.flat(Infinity),
    }),
    useEffect: () => {},
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value: any) => {
          slots[index] = value;
        },
      ];
    },
  };
  const Page = createInstruments({
    React,
    kit: Object.fromEntries(
      ["ArtifactFrame", "Switcher", "Picker", "Input", "Table", "Code", "Mermaid", "Button"].map(
        (key) => [key, key],
      ),
    ),
    useState: () => ({
      state: structuredClone(initialCircuitState),
      fire: async (event: any) => calls.push(event),
    }),
    target: async () => target,
    read: async (key: string, input: unknown) => {
      calls.push({ key, input });
      if (refusal) throw Error(refusal);
      return { entries: [] };
    },
    do: async () => ({ v: 1, rows: [], total: 0, copyOnly: true }),
  });
  const render = () => {
    cursor = 0;
    return Page();
  };
  const find: (node: any, predicate: (node: any) => boolean) => any = (
    node: any,
    predicate: (node: any) => boolean,
  ) => {
    if (!node || typeof node !== "object") return;
    if (predicate(node)) return node;
    for (const child of node.children || []) {
      const hit = find(child, predicate);
      if (hit) return hit;
    }
  };
  const control = (label: string) =>
    find(render(), (node) => node.props.label === label || node.props["aria-label"] === label);
  return { calls, render, control, find };
}

test("circuit reads require panel names and send only that scope to the roster", async () => {
  const page = calcBreakdown();
  await page.control("Read circuits").props.onClick();
  expect(page.calls).toEqual([]);
  page.control("Panel names").props.onChange({ target: { value: " C6P, C7P, C6P, " } });
  await page.control("Read circuits").props.onClick();
  expect(page.calls[0]).toEqual({
    key: "revit.catalog.electrical-circuits.roster",
    input: { filter: { panelNames: ["C6P", "C7P"] } },
  });
  expect(page.calls[1]).toMatchObject({ type: "reading", reading: { panelNames: ["C6P", "C7P"] } });
});

test("a circuit read displays the host refusal verbatim and publishes no reading", async () => {
  const message = "'revit.catalog.electrical-circuits.roster' refused by the host.";
  const page = calcBreakdown(message);
  page.control("Panel names").props.onChange({ target: { value: "C6P" } });
  await page.control("Read circuits").props.onClick();
  expect(page.find(page.render(), (node) => node.children.includes(message))).toBeTruthy();
  expect(page.calls).toHaveLength(1);
});

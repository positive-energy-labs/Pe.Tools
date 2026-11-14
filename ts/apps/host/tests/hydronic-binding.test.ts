import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vite-plus/test";
import { size, fromRevit } from "../../../../examples/pods/hydronic/pages/sizing/size.mjs";

// Execute the shipped Page's actual module and click its Apply handler. The tiny kit records
// its element tree; this proves handler behavior, not a browser's layout.
test.each([
  { session: "B", openId: "A" },
  { session: "A", openId: "B" },
])("saved reading A refuses current binding %j before pe.diff", async target => {
  const html = await readFile(new URL("../../../../examples/pods/hydronic/pages/sizing/index.html", import.meta.url), "utf8");
  const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)![1]!.replace(/import .*?from .*?;/, "");
  let tree: any;
  const h = (type: any, props: any, ...children: any[]) => typeof type === "function" ? type(props) : { type, props, children };
  const state = { limits: { maxVelocity: 1.5, maxFriction: 400 }, chosen: { p: 32 }, reading: {
    target: { session: "A", openId: "A" }, at: "saved", system: "s", systems: [], rooted: true,
    pipes: [{ uniqueId: "p", label: "p", flow: 0.3, diameter: 25, length: 10, upstream: null, segment: "s" }],
    catalogs: { s: [{ nominal: 25, inner: 26 }, { nominal: 32, inner: 32.1 }] },
  } };
  const pe = { kitReady: Promise.resolve(), kit: { h, createRoot: () => ({ render: (next: any) => { tree = next; } }), React: { Fragment: "fragment" }, Button: "button", Input: "input", Code: "code" },
    target: async () => target, diff: vi.fn(), state: async ({ render }: any) => {
      queueMicrotask(() => render(state)); return { state, fire: vi.fn() };
    } };
  await new (Object.getPrototypeOf(async function () {}).constructor)("pe", "document", "size", "fromRevit", source)(pe, { getElementById() {} }, size, fromRevit);
  const nodes = (node: any): any[] => !node || typeof node !== "object" ? [] : [node, ...(node.children ?? []).flat(Infinity).flatMap(nodes)];
  const apply = nodes(tree).find(node => node.type === "button" && node.children.includes("Apply chosen diameters"));
  expect(apply).toBeTruthy();
  await apply.props.onClick();
  expect(pe.diff).not.toHaveBeenCalled();
  expect(JSON.stringify(tree)).toContain("Binding changed. Read again before applying.");
});

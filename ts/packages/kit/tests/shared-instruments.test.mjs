import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";

const routeUrl = new URL(
  "../../../../examples/pods/snowdon-circuits/routes/voltage-drop/index.js",
  import.meta.url,
);
const sharedUrl = new URL(
  "../../../../examples/pods/snowdon-circuits/pages/tour/instruments.mjs",
  import.meta.url,
);
const module = () => import(routeUrl);

test("authored instrument labels retain their exact Unicode", async () => {
  const source = await readFile(sharedUrl, "utf8");
  for (const mark of ["\u00b7", "\u25b3", "\u0394", "\u00d7", "\u03c6", "\u2192"])
    assert.ok(source.includes(mark), `Missing instrument mark ${mark}`);
  assert.doesNotMatch(source, /[\u00c2\u00c3\u00ce\u00cf]/);
});

function harness(initial, reducer, options = {}) {
  let state = structuredClone(initial);
  const effects = [];
  const calls = [];
  const themes = [];
  const React = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (value) => [value, () => {}],
    useEffect: (fn) => effects.push(fn),
  };
  const kit = Object.fromEntries(
    ["ArtifactFrame", "PaneTabs", "Picker", "Input", "Table", "Code", "Mermaid", "Button"].map(
      (key) => [key, key],
    ),
  );
  const target = { session: "s", openId: "doc", title: "Model copy" };
  kit.writeTheme = (theme) => themes.push(theme);
  const api = {
    React,
    kit,
    sources: {},
    getState: () => state,
    useState: () => ({
      state,
      fire: (event) => {
        state = reducer(state, event);
      },
    }),
    target: async () => target,
    read: async (key, input) => {
      calls.push({ key, input });
      return { entries: [] };
    },
    do: async (key, input) => {
      calls.push({ key, input });
      return { status: "Succeeded", data: { v: 1, rows: [], total: 0, copyOnly: true } };
    },
    exportSnapshot: async (snapshot) => calls.push({ export: snapshot }),
    ...options,
  };
  return { api, calls, effects, themes, state: () => state };
}
function all(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...(node.children || []).flat(Infinity).flatMap(all)];
}
function button(tree, label) {
  return all(tree).find((node) => node.props.label === label);
}

test("the authored route applies saved theme through the shared kit", async () => {
  const route = await module();
  const h = harness({ ...route.initial, theme: "dark" }, route.reducer);
  route.create(h.api)();
  for (const effect of h.effects) effect();
  assert.deepEqual(h.themes, ["dark"]);
});

test("bundled route uses the same explicit factory and reducer as the Page", async () => {
  const route = await module();
  const shared = await import(sharedUrl);
  const circuit = await import(
    new URL("../../../../examples/pods/snowdon-circuits/pages/tour/circuits.mjs", import.meta.url)
  );
  const routeHarness = harness(route.initial, route.reducer);
  const pageHarness = harness(circuit.initialCircuitState, circuit.circuitReduce);
  const shape = (tree) =>
    JSON.stringify(tree, (_key, value) => (typeof value === "function" ? value.toString() : value));
  assert.equal(
    shape(route.create(routeHarness.api)()),
    shape(shared.createInstruments(pageHarness.api)()),
  );
  const event = { v: route.version, type: "input", key: "amps", value: "12" };
  assert.deepEqual(
    route.reducer(route.initial, event),
    circuit.circuitReduce(circuit.initialCircuitState, event),
  );
  const source = await readFile(routeUrl, "utf8");
  assert.doesNotMatch(source, /^(?:import|export .* from) /m);
  const executable = source.replace(/^const authoredSources = .*;$/m, "");
  assert.doesNotMatch(
    executable,
    /\b(?:pe|window|globalThis)\.|(?<![.\w])document\.(?:getElement|querySelector|documentElement|createElement)|eval\(|new Function/,
  );
});

test("generated portable Page executes the shared instruments with its pe.kernel adapter", async () => {
  const route = await module();
  const h = harness(route.initial, route.reducer);
  let mounted;
  let kernel;
  const exported = { snapshot: structuredClone(route.initial), exportedAt: 123 };
  const source = await readFile(
    new URL("../../../../examples/pods/snowdon-circuits/pages/tour/index.html", import.meta.url),
    "utf8",
  );
  const sources = /<script id="page-source" type="application\/json">([\s\S]*?)<\/script>/.exec(
    source,
  )[1];
  const window = {};
  const context = {
    structuredClone,
    URLSearchParams,
    console,
    window,
    location: { hash: "", pathname: "/snapshot.html", search: "" },
    history: { replaceState() {} },
    document: {
      getElementById: (id) => (id === "page-source" ? { textContent: sources } : {}),
      documentElement: { dataset: {}, classList: { toggle() {} } },
    },
    pe: {
      exported,
      kitReady: Promise.resolve(),
      kit: {
        ...h.api.kit,
        React: h.api.React,
        h: h.api.React.createElement,
        useState: h.api.React.useState,
        createRoot: () => ({
          render: (element) => {
            mounted = element.type();
          },
        }),
      },
      kernel: (reducer, state, changed) => {
        kernel = {
          state,
          log: [],
          fire: (event) => {
            kernel.log.push(event);
            kernel.state = reducer(kernel.state, event);
            changed();
          },
        };
        return kernel;
      },
      state: async () => {},
      describe() {},
    },
  };
  for (const [, script] of source.matchAll(/<script>([\s\S]*?)<\/script>/g))
    await new Script(script).runInNewContext(context);
  for (const effect of h.effects) effect();
  await Promise.resolve();
  assert.ok(button(mounted, "Change theme"));
  assert.equal(button(mounted, "Read circuits"), undefined);
  const target = all(mounted).find((node) => node.props["aria-label"] === "Design target percent");
  target.props.onChange({ target: { value: "4" } });
  assert.equal(kernel.state.target, "4");
  assert.equal(window.pageState.state.v, 1);
});

test("both adapters keep real reading identity through snapshot export and offline calculation", async () => {
  const route = await module();
  const row = {
    id: 91,
    panel: "LP-1",
    number: "7",
    load: "Lights",
    size: "10",
    length: 200,
    amps: 10,
    voltage: 120,
    phase: "1",
    material: "Copper",
    elementIds: [],
  };
  const reading = {
    document: { session: "s", openId: "doc", title: "Model copy" },
    at: 123,
    copyOnly: true,
    rows: [row],
  };
  const initial = route.reducer(route.reducer(route.initial, { v: 1, type: "reading", reading }), {
    v: 1,
    type: "select",
    id: 91,
  });
  const live = harness(initial, route.reducer);
  await button(route.create(live.api)(), "Export snapshot").props.onClick();
  assert.deepEqual(live.calls[0].export.reading, reading);
  const offline = harness(live.calls[0].export, route.reducer, {
    exported: { snapshot: initial, exportedAt: 123 },
  });
  const tree = route.create(offline.api)();
  for (const label of [
    "Read circuits",
    "Export snapshot",
    "Prepare wire proposal",
    "Approve and apply wire change",
  ])
    assert.equal(button(tree, label), undefined);
  const target = all(tree).find((node) => node.props["aria-label"] === "Design target percent");
  target.props.onChange({ target: { value: "4" } });
  assert.equal(offline.state().target, "4");
  assert.deepEqual(offline.state().reading, reading);
  assert.equal(offline.state().selectedId, 91);
  assert.deepEqual(offline.calls, []);
});

test("wire preparation uses exact evidence and a changed binding refuses before dispatch", async () => {
  const route = await module();
  const evidence = {
    elementId: 91,
    parameterId: -114,
    storageType: "String",
    isReadOnly: false,
    rawValue: "12",
  };
  const row = {
    id: 91,
    size: "10",
    length: 200,
    amps: 10,
    voltage: 120,
    phase: "1",
    material: "Copper",
    elementIds: [],
    wireParameter: { parameterId: -114 },
  };
  const state = {
    ...route.initial,
    selectedId: 91,
    reading: { document: { session: "s", openId: "doc" }, rows: [row], copyOnly: true },
  };
  const exact = harness(state, route.reducer);
  exact.api.do = async (key, input) => {
    exact.calls.push({ key, input });
    return { results: [{ current: evidence }] };
  };
  await button(route.create(exact.api)(), "Prepare wire proposal").props.onClick();
  assert.equal(exact.calls[0].key, "revit.apply.parameter-values");
  assert.equal(exact.calls[0].input.dryRun, true);
  assert.deepEqual(exact.state().proposal.input.edits[0].expected, evidence);
  const changed = harness(state, route.reducer, {
    target: async () => ({ session: "s", openId: "other", title: "Model copy" }),
  });
  await button(route.create(changed.api)(), "Prepare wire proposal").props.onClick();
  assert.deepEqual(changed.calls, []);
});

test("copy-only wire guard refuses before any dispatch", async () => {
  const route = await module();
  const row = {
    id: 91,
    size: "10",
    length: 200,
    amps: 10,
    voltage: 120,
    phase: "1",
    material: "Copper",
    elementIds: [],
    wireParameter: { parameterId: -114 },
  };
  for (const [title, copyOnly] of [
    ["Model", true],
    ["Model copy", false],
  ]) {
    const state = {
      ...route.initial,
      selectedId: 91,
      reading: { document: { session: "s", openId: "doc" }, rows: [row], copyOnly },
    };
    const h = harness(state, route.reducer, {
      target: async () => ({ session: "s", openId: "doc", title }),
    });
    await button(route.create(h.api)(), "Prepare wire proposal").props.onClick();
    assert.deepEqual(h.calls, []);
    assert.equal(h.state().proposal, null);
  }
});

/* Page consumer: ordinary HTML + pe.kit. No bundler, JSX, CDN or host required by the author. */
const { h, createRoot, useEffect, useReducer, ArtifactFrame, PaneTabs, Picker, Input, Table, Code, Mermaid, Button } = pe.kit;
const initial = { size: "10", length: "150", amps: "24", voltage: "208", phase: "3", tab: "inputs", theme: "system" };
const sources = JSON.parse(document.getElementById("page-source").textContent);
const log = [];
const tabs = ["inputs", "trace", "source"].map(value => ({ value, label: {inputs: "Inputs", trace: "Calc trace", source: "Source"}[value], title: `Show ${value}` }));
const fmt = value => value.toFixed(2);
const numeric = state => ({ ...state, length: state.length.trim() === "" ? NaN : Number(state.length), amps: state.amps.trim() === "" ? NaN : Number(state.amps), voltage: state.voltage.trim() === "" ? NaN : Number(state.voltage) });
/* ==== kernel v2 · adapted from slot.page/kit/sandbox.html: pure reducer + replayable events ==== */
function reduce(state, event) {
  if (event.type === "restore") return event.state;
  if (event.type === "reset") return { ...initial, theme: state.theme };
  if (event.type === "set" && Object.hasOwn(initial, event.key)) return { ...state, [event.key]: event.value };
  return state;
}
function fromUrl() {
  const params = new URLSearchParams(location.hash.slice(1));
  const state = { ...initial };
  for (const key of Object.keys(initial)) if (params.has(key)) state[key] = params.get(key);
  if (!tabs.some(tab => tab.value === state.tab)) state.tab = "inputs";
  if (!["system", "light", "dark"].includes(state.theme)) state.theme = "system";
  return state;
}
/* ==== end kernel ==== */
const base = fromUrl();
function Page() {
  const [state, dispatch] = useReducer(reduce, base);
  const fire = event => { log.push(event); dispatch(event); };
  const set = (key, value) => fire({ type: "set", key, value });
  useEffect(() => {
    const restore = () => { const event = { type: "restore", state: fromUrl() }; log.push(event); dispatch(event); };
    addEventListener("hashchange", restore);
    return () => removeEventListener("hashchange", restore);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    history.replaceState(null, "", `${location.pathname}${location.search}#${new URLSearchParams(state)}`);
    window.pageState = { state, events: log, source: "Copper K method, 75 C; manually entered example inputs" };
  }, [state]);
  let result, error;
  try { result = calculate(numeric(state)); } catch (e) { error = e.message; }
  const rows = result ? sizes.map(row => ({ ...row, ...calculate({ ...numeric(state), size: row.size }) })) : [];
  const columns = [
    { key: "size", label: "Copper · AWG", cell: row => h(Button, { label: `Use ${row.size} AWG`, pressed: state.size === row.size, onClick: () => set("size", row.size) }, `${state.size === row.size ? "● " : ""}${row.size}`) },
    { key: "drop", label: "Drop · V", cell: row => h("span", {className: "mono"}, fmt(row.drop)), sort: row => row.drop },
    { key: "percent", label: "Drop · %", cell: row => h("span", {className: "mono"}, fmt(row.percent)), sort: row => row.percent },
    { key: "criterion", label: "3% target", cell: row => h("span", { "data-tone": row.percent > 3 ? "alarm" : undefined }, row.percent > 3 ? "△ Above" : "✓ Within") },
  ];
  const pick = (key, label, options) => h("div", { className: "field", key }, h("span", { className: "muted" }, label), h(Picker, {
    anchor: "trigger", face: "field", triggerLabel: label, trigger: options.find(o => o.value === state[key])?.label ?? "Choose…", "aria-label": label,
    items: options, keyOf: o => o.value, labelOf: o => o.label, filter: "substring", empty: "No options", selected: [state[key]], select: "single",
    onPick: o => set(key, o.value), row: o => ({ label: o.label }),
  }));
  const field = (key, label, min) => h("label", { className: "field", key }, h("span", { className: "muted" }, label), h(Input, { "aria-label": label, type: "number", min, step: "any", value: state[key], face: "mono", onChange: event => set(key, event.target.value) }));
  const trace = result ? `Copper K method · approximate, 75 °C\n\nΔV = multiplier × K × I × L / CM\n   = ${result.multiplier.toFixed(6)} × 12.9 × ${state.amps} × ${state.length} / ${result.area}\n   = ${result.drop.toFixed(6)} V\n\nDrop = ΔV / ${state.voltage} × 100\n     = ${result.percent.toFixed(6)} %\nLoad voltage = ${state.voltage} − ΔV\n             = ${result.delivered.toFixed(6)} V\n\nOne-way length; balanced load; PF = 1.\nReactance, ampacity, derating and motor\nstarting are not evaluated.` : error;
  const diagram = result ? `flowchart LR\n S["Supply · ${state.voltage} V"] --> W["${state.size} AWG Cu · ${state.length} ft"]\n W --> L["Load · ${state.amps} A"]` : "";
  return h("main", null,
    h("header", { className: "mast" }, h("span", { className: "eyebrow" }, "PE / Pages / Electrical"), h("div", { style: {display: "flex", gap: 12} }, h("span", { className: "muted" }, "Local calculation · no model connection"), h(Button, { label: "Change theme", onClick: () => set("theme", state.theme === "dark" ? "light" : "dark") }, state.theme === "dark" ? "Light" : "Dark"))),
    h("div", { className: "heading" }, h("div", null, h("h1", null, "Voltage drop"), h("p", { className: "muted" }, "Compare copper sizes. Keep the assumptions beside the answer.")), h(Button, { label: "Reset example", kind: "framed", onClick: () => fire({type: "reset"}) }, "Reset example")),
    h("div", { className: "workspace" },
      h("section", { "aria-label": "Results" },
        error ? h("p", { role: "alert", className: "error" }, error) : h("div", { className: "summary", "aria-live": "polite" },
          ...[["Voltage drop", fmt(result.drop), "V"], ["Percent drop", fmt(result.percent), "%"], ["At the load", fmt(result.delivered), "V"]].map(([label, value, unit]) => h("div", {key: label}, h("div", {className: "muted"}, label), h("div", {className: "metric", "data-testid": label}, value, h("span", {className: "unit"}, unit))))),
        h("div", { className: "section-head" }, h("h2", null, "Conductor comparison"), h("span", { className: "muted" }, "Choose a size below")),
        h("div", { className: "comparison" }, h(Table, { rows, columns, rowKey: row => row.size, label: "Conductor comparison", activeKey: state.size, maxHeight: "400px", empty: "Complete the inputs to compare conductors." })),
        h("p", { className: "result-note muted" }, "△ 3% is this example’s design target. It is not an ampacity or code check.")),
      h("section", { "aria-label": "Calculation artifact" }, h(ArtifactFrame, { label: "Voltage drop worksheet", head: h("span", null, "Calculation / VD-001"), foot: h("span", {className: "muted"}, "Copper · 75 °C · resistance only") },
        h(PaneTabs, { options: tabs, value: state.tab, onChange: value => set("tab", value), ariaLabel: "Artifact views" }),
        h("div", { className: "artifact-body" }, state.tab === "inputs" ? h("div", { className: "fields" },
          pick("size", "Conductor size", sizes.map(row => ({value: row.size, label: `${row.size} AWG · copper`}))),
          field("length", "One-way length · ft", 0), field("amps", "Load · A", 0), field("voltage", "Supply · V", 0),
          pick("phase", "Phase", [{value: "1", label: "1φ · two wire"}, {value: "3", label: "3φ · balanced"}]))
          : state.tab === "trace" ? h(Code, { code: trace, lang: "text", title: "Calculation trace" })
          : h(Code, { code: `${sources.calc}\n\n${sources.app}`, lang: "js", title: "Editable Page source" })),
        h("div", { className: "notes muted" }, "Example inputs, entered by hand. Voltage is line-to-line for 3φ. Length is one way. ", h("a", {href: "https://iaeimagazine.org/2017/march2017/voltage-drop-formulas/", target: "_blank", rel: "noreferrer"}, "Formula reference ↗"))),
        diagram ? h("div", { className: "diagram" }, h(Mermaid, {source: diagram, title: "One-line · balanced circuit"})) : null)),
    h("footer", { className: "foot muted" }, h("span", null, "Preliminary sizing worksheet · check the complete circuit design before use."), h("span", {className: "mono"}, "VD-001 / portable Page")));
}
createRoot(document.getElementById("app")).render(h(Page));
window.__walk = () => {
  const result = calculate({size: "10", length: 200, amps: 10, voltage: 120, phase: "1"});
  if (Math.abs(result.drop - 4.971098265895954) > 1e-8) throw new Error("single-phase reference vector");
  const events = [{type: "set", key: "amps", value: "0"}, {type: "set", key: "tab", value: "trace"}];
  if (calculate(numeric(events.reduce(reduce, initial))).drop !== 0) throw new Error("zero-load reducer replay");
  if (!document.querySelector("table")) throw new Error("real kit table not mounted");
  return ["reference vector", "reducer replay", "real kit table mounted"];
};

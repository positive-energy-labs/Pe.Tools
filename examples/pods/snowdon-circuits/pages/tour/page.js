/* Portable circuit worksheet. Shared state is the Page event log. */
(async () => {
await pe.kitReady;
const { React, h, createRoot, useState } = pe.kit;
const sources = JSON.parse(document.getElementById('page-source').textContent);
const base = structuredClone(initialCircuitState);
const params = new URLSearchParams(location.hash.slice(1));
for (const key of ['tab', 'theme', 'target']) if (params.has(key)) base[key] = params.get(key);
let redraw = () => {};
const kernel = await pe.state({
  reduce: circuitReduce, base, render: state => redraw(state),
  describe: state => '# Voltage drop\n\n' + JSON.stringify(state, null, 2),
  local: ['select', 'proposal', 'receipt'],
});
const Page = createInstruments({
  React, kit: pe.kit, sources, exported: pe.exported,
  getState: () => kernel.state,
  useState: () => {
    const [state, setState] = useState(kernel.state);
    redraw = setState;
    return { state, fire: event => kernel.fire(event) };
  },
  target: () => pe.target(), read: (key, input) => pe.read(key, input), do: (key, input) => pe.do(key, input),
  initialize: async () => {
    redraw(kernel.state);
  },
  onState: state => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
    history.replaceState(null, '', location.pathname + location.search + '#' + new URLSearchParams({ tab: state.tab, theme: state.theme, target: state.target }));
    window.pageState = { state, events: pe.exported?.events };
  },
  onCapture: captured => { window.pageCapture = captured; },
  exportSnapshot: async () => {
    const response = await pe.fetch('/pages/' + encodeURIComponent(pe.slug) + '/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error(await response.text());
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a'); a.href = url; a.download = 'voltage-drop-snapshot.html'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
});
createRoot(document.getElementById('app')).render(h(Page));
window.__walk = () => {
  const r = calculate({ size: '10', length: 200, amps: 10, voltage: 120, phase: '1' });
  if (Math.abs(r.drop - 4.971098265895954) > 1e-8) throw new Error('Reference calculation changed');
  if (!document.querySelector('table')) throw new Error('Kit table not mounted');
  return ['reference vector', 'kit circuit table', 'schema v1'];
};
})().catch(error => { document.getElementById('app').textContent = error.message; console.error(error); });

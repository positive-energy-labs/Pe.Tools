/* Portable Page adapter; instruments and calculation are shared with the authored route. */
(async () => {
await pe.kitReady;
const { React, h, createRoot, useState } = pe.kit;
const sources = JSON.parse(document.getElementById('page-source').textContent);
const base = pe.exported?.snapshot?.v === SCHEMA_VERSION ? structuredClone(pe.exported.snapshot) : structuredClone(initialCircuitState);
const params = new URLSearchParams(location.hash.slice(1));
for (const key of ['tab', 'theme', 'target']) if (params.has(key)) base[key] = params.get(key);
let redraw = () => {};
const kernel = pe.kernel(circuitReduce, base, () => redraw(kernel.state));
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
    pe.describe(() => '# Voltage drop\n\nDocument: ' + (kernel.state.reading?.document?.title || 'Manual calculation') + '\nRead at: ' + (kernel.state.reading?.at ? new Date(kernel.state.reading.at).toLocaleString() : 'No reading yet') + '\nTarget: ' + kernel.state.target + '%\n\n' + JSON.stringify(kernel.state, null, 2));
    await pe.state(kernel, { local: ['select', 'set', 'proposal', 'receipt', 'input'] });
    redraw(kernel.state);
  },
  onState: state => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
    history.replaceState(null, '', location.pathname + location.search + '#' + new URLSearchParams({ tab: state.tab, theme: state.theme, target: state.target }));
    window.pageState = { state, events: kernel.log };
  },
  onCapture: captured => { window.pageCapture = captured; },
  exportSnapshot: async snapshot => {
    const response = await pe.fetch('/pages/' + encodeURIComponent(pe.slug) + '/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot }) });
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

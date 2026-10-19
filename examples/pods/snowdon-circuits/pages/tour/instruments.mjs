import { SCHEMA_VERSION, adaptCircuits, circuitCalculation, wireProposal } from './circuits.mjs';
import { sizes } from './calc.mjs';
import { worksheetCss } from './styles.mjs';

/** Both shells supply the same React and kit instances and their own state/door adapter. */
export function createInstruments(api) {
const React = api.React;
const { createElement: h, useEffect, useState } = React;
const { ArtifactFrame, PaneTabs, Picker, Input, Table, Code, Mermaid, Button } = api.kit;
const offline = Boolean(api.exported);
const sources = api.sources || {};
const fmt = value => value == null ? 'Unavailable' : Number(value).toFixed(2);
const when = at => at ? new Date(at).toLocaleString() : 'No reading yet';
const tabs = ['inputs', 'trace', 'source'].map(value => ({ value, label: { inputs: 'Inputs', trace: 'Calc trace', source: 'Source' }[value], title: 'Show ' + value }));

function VoltageDrop() {
  const { state, fire: dispatch } = api.useState();
  const fire = event => dispatch({ ...event, v: SCHEMA_VERSION });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [bound, setBound] = useState(null);
  const [filter, setFilter] = useState('');
  const [inspection, setInspection] = useState(null);
  const [picture, setPicture] = useState(null);
  const rows = state.reading?.rows || [];
  const visible = rows.filter(row => [row.panel, row.number, row.load, row.id].join(' ').toLowerCase().includes(filter.toLowerCase()));
  const counts = rows.reduce((counts, row) => { const status = circuitCalculation(row, state.overrides[row.id], state.target).status; counts[status]++; return counts; }, { above: 0, within: 0, unavailable: 0 });
  const selected = rows.find(row => row.id === state.selectedId);
  const overrides = state.overrides[state.selectedId] || {};
  const result = circuitCalculation(selected || { ...state.inputs }, selected ? overrides : {}, state.target);
  const input = result.input;
  const set = (key, value) => fire({ type: 'set', key, value });
  const act = async (label, run) => {
    setBusy(label); setError('');
    try { await run(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const assertTarget = async () => {
    const target = await api.target(); setBound(target);
    const read = api.getState().reading?.document;
    if (!read || read.session !== target.session || read.openId !== target.openId) throw new Error('The binding changed since this circuit reading. Read circuits again before acting.');
    return target;
  };
  const refresh = async () => {
    const target = await api.target(); setBound(target);
    const catalog = await api.read('revit.catalog.electrical-circuits', {});
    const response = await api.do('script:@snowdon-circuits/src/Census.cs', { permissionMode: 'ReadOnly', timeoutSeconds: 60 });
    if (response?.status !== 'Succeeded') throw new Error('Circuit census ' + (response?.status || 'returned no result') + ': ' + (response?.diagnostics || []).map(d => d.message).join('; '));
    const values = response.data;
    if (!values || values.error) throw new Error(values?.error || 'Circuit census returned no data.');
    const current = await api.target();
    if (current.session !== target.session || current.openId !== target.openId) throw new Error('The binding changed during the reading. Read circuits again.');
    await fire({ type: 'reading', reading: { v: SCHEMA_VERSION, source: 'revit.catalog.electrical-circuits + script:@snowdon-circuits/src/Census.cs', at: Date.now(), document: target, copyOnly: values.copyOnly, total: values.total, rows: adaptCircuits(catalog, values), issues: catalog.issues || [] } });
  };
  const assertCopy = async () => {
    const target = await assertTarget();
    if (!/copy|sandbox/i.test(target.title || '') || api.getState().reading?.copyOnly !== true) throw new Error('Wire changes are refused outside a disposable copy. Open a model whose title includes copy or sandbox, bind it, then read circuits.');
  };
  const show = async row => {
    await assertTarget();
    if (!row.elementIds.length) throw new Error('This circuit has no connected load or wire elements to show.');
    const lens = await api.do('revit.context.lens', { elementIds: row.elementIds });
    await api.do('revit.context.show-elements', { elementIds: row.elementIds, viewId: lens.viewId });
  };
  const select = row => {
    fire({ type: 'select', id: row.id });
    setPicture(null); setInspection(null); api.onCapture?.(null);
    if (!offline && row.elementIds.length) act('Highlighting circuit', async () => {
      await show(row);
    });
  };
  const prepare = () => act('Reading wire evidence', async () => {
    await assertCopy();
    if (!selected.wireParameter) throw new Error('The circuit has no Wire Size parameter. The override changes this calculation only.');
    const answer = await api.do('revit.apply.parameter-values', { dryRun: true, edits: [{ elementId: selected.id, parameterId: selected.wireParameter.parameterId, value: input.size }] });
    const evidence = answer.results?.[0]?.current;
    if (!evidence) throw new Error(answer.results?.[0]?.error || 'Revit did not return exact wire evidence.');
    await fire({ type: 'proposal', proposal: wireProposal(selected, input.size, evidence) });
  });
  const approve = () => act('Applying approved wire change', async () => {
    const proposal = api.getState().proposal;
    await assertCopy();
    if (!proposal || proposal.circuitId !== api.getState().selectedId) throw new Error('Prepare the selected circuit proposal again.');
    if (proposal.blocked || !proposal.input) throw new Error(proposal.blocked || 'This proposal has no executable change.');
    const receipt = await api.do(proposal.key, proposal.input);
    if (receipt.applied !== 1) throw new Error(receipt.results?.[0]?.error || 'Revit did not apply the conductor change.');
    await refresh();
    await fire({ type: 'receipt', receipt: { at: Date.now(), ...receipt } });
  });
  const inspect = () => act('Inspecting selected circuit', async () => {
    await show(selected);
    const response = await api.do('script:@snowdon-circuits/src/InspectRun.cs', { permissionMode: 'ReadOnly', timeoutSeconds: 60 });
    if (response?.status !== 'Succeeded') throw new Error('Inspect circuit ' + (response?.status || 'returned no result'));
    setInspection({ source: 'script:@snowdon-circuits/src/InspectRun.cs', at: Date.now(), rows: response.data });
    set('tab', 'trace');
  });
  const capture = () => act('Capturing selected circuit', async () => {
    await assertTarget();
    const lens = await api.do('revit.context.lens', { elementIds: selected.elementIds, paddingFeet: 8 });
    // Export the padded lens as configured. Focus would crop the tiny load again and lose its context.
    const response = await api.read('revit.context.view-image', { target: { id: lens.viewId }, pixelSize: 2000 });
    const url = response.captureUrl || response.imageUrl;
    if (!url) throw new Error('The circuit lens image was not kept by the host.');
    const image = { url, sha: (url.match(/([a-f0-9]{64})/i) || [])[1] || null, at: Date.now(), viewId: lens.viewId, viewName: lens.viewName, registration: response.registration || null };
    const current = await api.target();
    const read = api.getState().reading.document;
    if (current.session !== read.session || current.openId !== read.openId) throw new Error('The binding changed while capturing. Capture the circuit again.');
    const captured = { ...image, document: read, circuitId: selected.id, panel: selected.panel, number: selected.number };
    setPicture(captured); api.onCapture?.(captured);
  });
  const exportPage = () => act('Exporting snapshot', () => api.exportSnapshot(api.getState()));
  useEffect(() => {
    Promise.resolve(api.initialize?.()).catch(e => setError(e.message));
    if (!offline) api.target().then(setBound).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    api.onState?.(state);
  }, [state]);
  const change = (key, value) => fire({ type: selected ? 'override' : 'input', key, value });
  const pick = (key, label, options) => h('div', { className: 'field', key }, h('span', { className: 'muted' }, label), h(Picker, {
    anchor: 'trigger', face: 'field', triggerLabel: label, trigger: options.find(o => o.value === input[key])?.label ?? 'Unavailable · choose override', 'aria-label': label,
    items: options, keyOf: o => o.value, labelOf: o => o.label, filter: 'substring', empty: 'No options', selected: input[key] ? [input[key]] : [], select: 'single', onPick: o => change(key, o.value), row: o => ({ label: o.label }),
  }));
  const field = (key, label) => h('label', { className: 'field', key }, h('span', { className: 'muted' }, label), h(Input, { 'aria-label': label, placeholder: 'Unavailable · enter override', type: 'number', min: 0, step: 'any', value: input[key] ?? '', face: 'mono', onChange: event => change(key, event.target.value) }));
  const num = (row, key) => h('span', { className: 'mono' }, fmt(row[key]));
  const circuitColumns = [
    { key: 'panel', label: 'Panel', cell: row => h(Button, { label: 'Select ' + row.panel + ' circuit ' + row.number, pressed: row.id === state.selectedId, onClick: () => select(row) }, row.panel) },
    { key: 'number', label: 'Circuit', cell: row => h('span', { className: 'mono', title: 'Circuit element ' + row.id }, row.number) },
    { key: 'load', label: 'Load', cell: row => row.load },
    ...[['amps', 'Load · A'], ['voltage', 'V'], ['poles', 'Poles'], ['length', 'Length · ft']].map(([key, label]) => ({ key, label, cell: row => num(row, key) })),
    { key: 'wireSize', label: 'Wire size', cell: row => row.wireSize || 'Unavailable' },
    { key: 'drop', label: 'Drop / target', cell: row => { const r = circuitCalculation(row, state.overrides[row.id], state.target); return h('span', { 'data-tone': r.status === 'above' ? 'alarm' : undefined, title: r.reason }, r.status === 'unavailable' ? 'Override required' : fmt(r.percent) + '% · ' + (r.status === 'above' ? '△ Above' : 'Within')); } },
  ];
  const comparison = result.status === 'unavailable' ? [] : sizes.map(row => ({ ...row, ...circuitCalculation({ ...input, size: row.size }, {}, state.target) }));
  const diagram = 'flowchart TD\n P[' + JSON.stringify(selected ? 'Panel ' + selected.panel + ' · circuit ' + selected.number : 'Manual supply') + '] --> W[' + JSON.stringify((input.size || 'Unavailable') + ' AWG · ' + fmt(input.length) + ' ft · ' + (input.material || 'Unavailable')) + ']\n W --> L[' + JSON.stringify((selected?.load || 'Manual load') + ' · ' + fmt(input.amps) + ' A / ' + fmt(input.voltage) + ' V') + ']';
  const trace = result.status === 'unavailable' ? result.reason : 'Copper K method · 75 °C, PF = 1\nΔV = ' + result.multiplier.toFixed(6) + ' × 12.9 × ' + input.amps + ' × ' + input.length + ' / ' + result.area + '\n   = ' + result.drop.toFixed(6) + ' V\nDrop = ' + result.percent.toFixed(6) + '%\n\n' + (selected ? 'Circuit element ' + selected.id + ' · ' + selected.panel + ' / ' + selected.number + '\nOverrides: ' + JSON.stringify(overrides) : 'Manually entered example; no Revit measurement') + '\n\nPoles 1/2 use the single-phase two-wire model.\nThree poles assume balanced three phase.\nOne-way path length. No reactance, ampacity, derating or code check.';
  return h(React.Fragment, null, h('style', null, worksheetCss), h('main', { className: 'snowdon-circuits' },
    h('header', { className: 'mast' }, h('span', { className: 'eyebrow' }, 'PE / Electrical'), h('div', { className: 'actions' }, h('span', { className: 'muted' }, offline ? 'Snapshot · ' + (api.exported?.document?.title || state.reading?.document?.title || 'Manual worksheet') : bound?.title || 'Choose a document'), h(Button, { label: 'Change theme', onClick: () => set('theme', state.theme === 'dark' ? 'light' : 'dark') }, state.theme === 'dark' ? 'Light' : 'Dark'))),
    h('div', { className: 'heading' }, h('div', null, h('h1', null, 'Voltage drop'), h('p', { className: 'muted' }, 'Read real electrical circuits. Compare conductors against an explicit design target.')), h('div', { className: 'actions' }, !offline ? h(Button, { label: 'Read circuits', kind: 'framed', disabled: !!busy, onClick: () => act('Reading circuits', refresh) }, 'Read circuits') : null, !offline ? h(Button, { label: 'Export snapshot', kind: 'framed', disabled: !!busy, onClick: exportPage }, 'Export snapshot') : null)),
    error ? h('p', { role: 'alert', className: 'error' }, error) : null,
    busy ? h('p', { role: 'status', className: 'muted' }, busy) : null,
    h('section', { 'aria-label': 'Electrical circuits' }, h('div', { className: 'section-head' }, h('h2', null, 'Electrical circuits'), h('span', { className: 'muted' }, (state.reading?.document?.title || 'No document reading') + ' · ' + when(state.reading?.at))),
      h('div', { className: 'actions' }, h(Input, { 'aria-label': 'Filter circuits', placeholder: 'Panel, circuit, load or element id', value: filter, onChange: event => setFilter(event.target.value) }), h('span', { className: 'muted' }, visible.length + ' shown / ' + rows.length + ' read'), selected && !offline ? h(Button, { label: 'Inspect selected circuit', disabled: !!busy, onClick: inspect }, 'Inspect selected circuit') : null, selected?.elementIds.length && !offline ? h(Button, { label: 'Capture selected circuit', disabled: !!busy, onClick: capture }, 'Capture selected circuit') : null),
      rows.length ? h('p', { className: 'result-note mono', 'aria-live': 'polite' }, 'Reading at ' + state.target + '% target: ' + counts.above + ' above · ' + counts.within + ' within · ' + counts.unavailable + ' override required') : null,
      h(Table, { rows: visible, columns: circuitColumns, rowKey: row => String(row.id), activeKey: String(state.selectedId), label: 'Electrical circuits', maxHeight: '380px', empty: rows.length ? 'No circuits match this filter. Clear the filter to see the reading.' : offline ? 'This snapshot has no circuit reading. The manual calculator remains available.' : 'Choose a document, then read circuits. No example rows stand in for the model.' }),
      h('p', { className: 'result-note muted' }, 'Select a panel row to fill the calculator and highlight its connected loads and wires in Revit. Missing values require an override.')),
    picture ? h('figure', { className: 'capture' }, h('img', { src: picture.url, alt: picture.document.title + ' · panel ' + picture.panel + ' circuit ' + picture.number + ' connected loads and wires', style: { maxWidth: '100%' } }), h('figcaption', { className: 'muted' }, picture.document.title + ' · circuit element ' + picture.circuitId + ' · captured ' + when(picture.at) + ' · ', h('a', { href: picture.url, target: '_blank', rel: 'noreferrer' }, picture.viewName + ' / view ' + picture.viewId))) : null,
    h('div', { className: 'workspace' },
      h('section', { 'aria-label': 'Results' }, h('div', { className: 'section-head' }, h('h2', null, selected ? selected.panel + ' / ' + selected.number : 'Manual example'), selected ? h(Button, { label: 'Clear circuit overrides', onClick: () => fire({ type: 'clear-overrides' }) }, 'Use measured values') : null),
        result.status === 'unavailable' ? h('p', { className: 'error' }, result.reason) : h('div', { className: 'summary', 'aria-live': 'polite' }, ...[['Voltage drop', result.drop, 'V'], ['Percent drop', result.percent, '%'], ['At the load', result.delivered, 'V']].map(([label, value, unit]) => h('div', { key: label }, h('div', { className: 'muted' }, label), h('div', { className: 'metric', 'data-testid': label }, fmt(value), h('span', { className: 'unit' }, unit))))),
        h('label', { className: 'target' }, 'Design target · %', h(Input, { 'aria-label': 'Design target percent', type: 'number', min: 0.01, step: 'any', value: state.target, onChange: event => set('target', event.target.value) })),
        h('div', { className: 'section-head' }, h('h2', null, 'Conductor comparison')), h(Table, { rows: comparison, columns: [
          { key: 'size', label: 'Copper · AWG', cell: row => h(Button, { label: 'Use ' + row.size + ' AWG', pressed: input.size === row.size, onClick: () => change('size', row.size) }, row.size) },
          { key: 'drop', label: 'Drop · V', cell: row => num(row, 'drop') }, { key: 'percent', label: 'Drop · %', cell: row => num(row, 'percent') },
          { key: 'status', label: 'Design target', cell: row => h('span', { 'data-tone': row.status === 'above' ? 'alarm' : undefined }, row.status === 'above' ? '△ Above' : 'Within') },
        ], rowKey: row => row.size, activeKey: input.size, label: 'Conductor comparison', maxHeight: '300px', empty: 'Complete the unavailable circuit facts to compare conductors.' })),
      h('section', { 'aria-label': 'Calculation artifact' }, h(ArtifactFrame, { label: 'Voltage drop worksheet', head: h('span', null, selected ? 'Circuit element ' + selected.id : 'Manual calculation'), foot: h('span', { className: 'muted' }, 'Copper · 75 °C · resistance only') },
        h(PaneTabs, { options: tabs, value: state.tab, onChange: value => set('tab', value), ariaLabel: 'Artifact views' }),
        h('div', { className: 'artifact-body' }, state.tab === 'inputs' ? h('div', { className: 'fields' },
          pick('size', 'Conductor size', sizes.map(row => ({ value: row.size, label: row.size + ' AWG · copper' }))), field('length', 'One-way length · ft'), field('amps', 'Apparent load · A'), field('voltage', 'Supply · V'),
          pick('phase', 'Phase assumption', [{ value: '1', label: '1φ · two wire' }, { value: '3', label: '3φ · balanced' }]), pick('material', 'Conductor material', [{ value: 'Copper', label: 'Copper · explicit confirmation' }]))
          : state.tab === 'trace' ? h(Code, { code: trace + (inspection ? '\n\nInspection at ' + when(inspection.at) + '\n' + JSON.stringify(inspection.rows, null, 2) : ''), lang: 'text', title: 'Calculation trace' }) : h(Code, { code: Object.values(sources).join('\n\n'), lang: 'js', title: 'Editable source' })),
        h('div', { className: 'notes muted' }, selected ? 'Measured material: ' + (selected.material || 'unavailable') + '. Measured wire: ' + (selected.wireSize || 'unavailable') + '. Overrides: ' + (Object.keys(overrides).join(', ') || 'none') + '.' : 'Manual example inputs. Select a real circuit above to replace them.', ' Calculation overrides do not change Revit.')),
        h('div', { className: 'diagram' }, h(Mermaid, { source: diagram, title: 'Circuit one-line · worksheet inputs' })),
        selected && !offline ? h('div', { className: 'proposal' }, h('h2', null, 'Wire change proposal'), h('p', { className: 'muted' }, 'Circuit ' + selected.id + ': ' + (selected.wireSize || 'unavailable') + ' → ' + (input.size || 'choose conductor') + ' AWG. Revit\'s calculated Wire Size may be read-only.'), h(Button, { label: 'Prepare wire proposal', kind: 'framed', disabled: !!busy, onClick: prepare }, 'Prepare proposal'), state.proposal ? h('div', null, h(Code, { code: JSON.stringify(state.proposal, null, 2), lang: 'json', title: 'Reviewed wire change' }), state.proposal.blocked ? h('p', { className: 'error' }, state.proposal.blocked) : h(Button, { label: 'Approve and apply wire change', kind: 'framed', disabled: !!busy, onClick: approve }, 'Approve and apply wire change')) : null, state.receipt ? h('p', { role: 'status' }, 'Applied ' + state.receipt.applied + ' change; circuit facts read again at ' + when(state.receipt.at) + '.') : null) : null)),
    h('footer', { className: 'foot muted' }, h('span', null, 'Design comparison only. Check ampacity, reactance, derating, load balance and complete circuit design.'), h('span', { className: 'mono' }, offline ? 'Exported ' + when(api.exported?.exportedAt) : 'Event schema ' + SCHEMA_VERSION))));
}

return VoltageDrop;
}

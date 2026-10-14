import { calculate, sizes } from "./calc.mjs";

export const SCHEMA_VERSION = 1;
export const initialCircuitState = { v: SCHEMA_VERSION, reading: null, selectedId: null, overrides: {}, inputs: { size: "10", length: "150", amps: "24", voltage: "208", phase: "3", material: "Copper" }, target: "3", tab: "inputs", theme: "system", proposal: null, receipt: null };
const finite = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = value => value == null ? "" : String(value);
const knownSize = value => {
  const raw = text(value).trim();
  if (sizes.some(row => row.size === raw)) return raw;
  if (/sets?|parallel|kcmil|\d\s*\/\s*\d/i.test(raw.replace(/\b1\/0\b/g, ""))) return null;
  // Every conductor token must be supported. A ground wire must never stand in for an unsupported hot wire.
  const tokens = [...raw.matchAll(/#\s*(\d+(?:\/0)?)/g)].map(match => match[1]);
  if (!tokens.length || tokens.some(token => !sizes.some(row => row.size === token))) return null;
  const match = raw.match(/#\s*(14|12|10|8|6|4|3|2|1\/0|1)\b/);
  if (!match) return null;
  const all = [...raw.matchAll(/#\s*(14|12|10|8|6|4|3|2|1\/0|1)\b/g)].map(m => m[1]);
  return new Set(all).size === 1 ? match[1] : null;
};

export function adaptCircuits(catalog, values) {
  if (values.v !== SCHEMA_VERSION) throw new Error("Unsupported circuit reading version.");
  const measurements = new Map(values.rows.map(row => [row.circuitId, row]));
  return catalog.entries.map(entry => {
    const measured = measurements.get(entry.circuitId);
    return {
      id: entry.circuitId, uniqueId: entry.circuitUniqueId, panel: entry.panelName || "Unassigned", number: entry.circuitNumber,
      load: entry.loadName || "Unnamed load", poles: entry.polesNumber,
      amps: finite(measured?.amps), voltage: finite(measured?.voltage), length: finite(measured?.length),
      wireSize: measured?.wireSize ?? entry.wireSize ?? null, size: measured ? knownSize(measured.wireSize) : null,
      material: measured?.material ?? null, phase: [1, 2].includes(entry.polesNumber) ? "1" : entry.polesNumber === 3 ? "3" : null,
      elementIds: [...new Set([...(entry.connectedElements || []).map(e => e.elementId), ...(entry.wires || []).map(w => w.wireId)])],
      wireParameter: measured?.wireParameter ?? null, unavailable: measured?.unavailable ?? ["Numeric circuit facts unavailable"],
    };
  });
}

export function circuitCalculation(row, overrides = {}, target = 3) {
  const input = { size: row.size, length: row.length, amps: row.amps, voltage: row.voltage, phase: row.phase, material: row.material, ...overrides };
  const missing = [];
  for (const key of ["length", "amps", "voltage"]) {
    if (input[key] === null || text(input[key]).trim() === "") missing.push(key);
    else input[key] = Number(input[key]);
  }
  if (!input.size) missing.push("conductor size");
  if (!input.phase) missing.push("phase");
  if (!/^copper|^cu$/i.test(input.material || "")) missing.push("copper material confirmation");
  if (missing.length) return { status: "unavailable", reason: `Override required: ${missing.join(", ")}.`, input };
  try {
    const result = calculate(input);
    if (!Number.isFinite(Number(target)) || Number(target) <= 0) throw new Error("Enter a design target greater than zero.");
    return { status: result.percent > Number(target) ? "above" : "within", input, ...result };
  } catch (error) { return { status: "unavailable", reason: error.message, input }; }
}

export function circuitReduce(state, event) {
  if (event.v !== SCHEMA_VERSION) return state;
  switch (event.type) {
    case "reading": {
      const before = state.reading?.document, after = event.reading.document;
      const sameDocument = before?.session === after?.session && before?.openId === after?.openId;
      return { ...state, reading: event.reading, selectedId: sameDocument && event.reading.rows.some(row => row.id === state.selectedId) ? state.selectedId : null, overrides: sameDocument ? state.overrides : {}, proposal: null, receipt: null };
    }
    case "select": return { ...state, selectedId: event.id, proposal: null, receipt: null };
    case "override": return { ...state, overrides: { ...state.overrides, [state.selectedId]: { ...state.overrides[state.selectedId], [event.key]: event.value } }, proposal: null };
    case "set": return ["target", "tab", "theme"].includes(event.key) ? { ...state, [event.key]: event.value, proposal: event.key === "target" ? null : state.proposal } : state;
    case "input": return Object.hasOwn(state.inputs, event.key) ? { ...state, inputs: { ...state.inputs, [event.key]: event.value } } : state;
    case "proposal": return { ...state, proposal: event.proposal, receipt: null };
    case "receipt": return { ...state, receipt: event.receipt, proposal: null };
    case "clear-overrides": return { ...state, overrides: { ...state.overrides, [state.selectedId]: {} }, proposal: null };
    default: return state;
  }
}

export function wireProposal(row, size, evidence) {
  if (!evidence || evidence.elementId !== row.id || !Number.isInteger(evidence.parameterId)) throw new Error("Exact wire parameter evidence is required.");
  if (!sizes.some(item => item.size === size)) throw new Error("Choose a supported conductor size.");
  if (evidence.isReadOnly) return { key: "revit.apply.parameter-values", circuitId: row.id, size, before: evidence.rawValue, evidence, input: null, blocked: "Revit's Wire Size parameter is read-only. This conductor choice is a calculation override; Revit must size the circuit through its electrical settings." };
  if (evidence.storageType !== "String") throw new Error("This wire parameter does not accept an AWG string.");
  return { key: "revit.apply.parameter-values", circuitId: row.id, size, before: evidence.rawValue, input: { dryRun: false, transactionName: "Page: approved circuit conductor change", edits: [{ elementId: row.id, parameterId: evidence.parameterId, value: size, expected: evidence }] } };
}

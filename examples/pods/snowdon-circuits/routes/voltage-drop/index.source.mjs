import { calculate, sizes } from '../../pages/tour/calc.mjs';

export function register({ z, field, pane, split, descriptor, workWriteCommands, writeIntentSchema }) {
  const route = descriptor.workRoute, roster = "pod.snowdon-circuits.roster", detail = "pod.snowdon-circuits.calculation";
  const write = "pod.snowdon-circuits.set-wire";
  const wire = z.object({ elementId: z.number().int(), parameterId: z.number().int(), value: z.enum(sizes.map(row => row.size)), expected: z.record(z.string(), z.json()) });
  const initial = { size: "10", length: 150, amps: 24, voltage: 208, phase: "3" };
  const inputs = z.object({ size: z.enum(sizes.map(row => row.size)), length: z.number().nonnegative(), amps: z.number().nonnegative(), voltage: z.number().positive(), phase: z.enum(["1", "3"]) });
  const work = { route, title: "Circuit voltage drop", description: "Authored calculation inputs", schemaVersion: 2,
    schema: z.object({ version: z.literal(2).default(2), inputs: inputs.default(initial), wireIntent: z.string().default(""), writeIntent: writeIntentSchema.default({}) }), editable: [["inputs", "*"], ["wireIntent"], ["writeIntent", "*"]],
    migrations: { 1: old => ({ version: 2, inputs: { ...initial, ...old.state?.inputs } }) },
  };
  const directory = { path: `/tool/${encodeURIComponent(descriptor.key)}`, title: "Circuit voltage drop", label: "Circuits", icon: "Boxes", category: "Calculate loads & airflow", blurb: work.description, aliases: ["circuit", "voltage", "conductor"], exposure: "Main", listed: true, runtimeNeed: "Host; Revit for circuit roster", satellites: [], surfaces: { web: "full", pwa: "full", tray: false } };
  const graph = { key: route, name: "Circuit voltage drop", address: directory.path.slice(1), directory, optionalTarget: "document", work: work.schema,
    subjectField: { field: "circuit", noun: "Electrical circuit", keyKind: "UniqueId", cardinality: "one", roster, detail, pane: "circuits", show: id => id },
    fields: { selected: { ...field(z.string().default(""), {}), role: "selection" }, circuit: { ...field(z.string().default("manual"), {}), role: "subject" } },
    readings: { [roster]: { kind: "use", source: roster, retire: "target" }, [detail]: { kind: "derive", source: detail, deps: [roster], retire: "page" } },
    verbs: { wireIntent: { kind: "work", label: "Edit wire intent", review: "none", input: z.string() }, stage: { kind: "work", label: "Stage wire change", review: "none", input: z.object({}).default({}) }, apply: { kind: "command", does: write, label: "Preview / apply wire change", review: "shown", input: z.object({}).default({}) }, input: { kind: "work", label: "Edit calculation input", review: "none", input: z.object({ key: z.enum(["size", "length", "amps", "voltage", "phase"]), value: z.union([z.string(), z.number()]) }) } },
    panes: { circuits: { label: "Circuits", purpose: "Pick a circuit", draws: [roster], verbs: [] }, calculation: { label: "Voltage drop", purpose: "Compare authored conductor inputs", draws: [detail], verbs: ["stage", "apply"] }, history: { label: "History", purpose: "Inspect calculation edits", draws: [], verbs: [], history: {} } },
    layout: split("circuit", { axis: "h", sized: "start", size: 240 }, pane("circuits"), split("result", { axis: "v", sized: "end", size: 160 }, pane("calculation"), pane("history"))),
    stages: { calculate: { word: "Calculate", panes: ["circuits", "calculation", "history"], verbs: [], teach: "Pick a circuit and author explicit inputs. Missing model facts remain unavailable." } }, stageOrder: ["calculate"],
    seeds: { calculator: { title: "Manual voltage drop", load: async () => ({ page: { circuit: "manual" }, work: work.schema.parse({}), readings: { [roster]: { entries: [] } } }) } },
  };
  return { version: 1, namespace: descriptor.packageId, key: `${descriptor.packageId}:${route}`, moduleHash: descriptor.sha256, graph, work,
    entries: { ...workWriteCommands(route, write, { axes: { subject: "Elements", touches: ["Metadata"], effect: "ModelWrite", cost: "Mutation", cardinality: "Many" }, says: "Set circuit wire size", native: ["revit.apply.parameter-values"], needs: "document", effect: "command", dirties: ["snapshot"], input: wire }), [roster]: { axes: { subject: "Document", touches: ["Topology"], effect: "Read", cost: "Cheap", cardinality: "One" }, says: "Read circuit roster", needs: "document", effect: "query", dirties: [], input: z.object({}).default({}) } },
    operations: { [write]: { key: "revit.apply.parameter-values", input: input => ({ dryRun: false, edits: [{ elementId: input.elementId, parameterId: input.parameterId, value: input.value, expected: input.expected }] }), retires: result => result?.dryRun === false && result?.applied === 1 && result?.results?.length === 1 && result.results[0].ok ? [["writeIntent", write]] : [] }, [roster]: { key: "revit.catalog.electrical-circuits.roster", input: () => ({}) } },
    readings: { [roster]: () => ({}) },
    derives: { [detail]: (page, work, readings) => {
      const circuit = readings[roster]?.entries?.find(row => row.circuitUniqueId === page.circuit);
      return { circuit: page.circuit === "manual" ? "Manual case" : circuit?.loadName ?? "Circuit facts unavailable", inputs: work?.inputs, result: work ? calculate(work.inputs) : null, source: "Authored calculation inputs, copper K method at 75 C" };
    } },
    edits: { wireIntent: (_work, value) => [{ path: ["wireIntent"], value }], stage: work => [{ path: ["writeIntent", write], value: { edit: { value: wire.parse(JSON.parse(work.wireIntent)) } } }], input: (work, { key, value }) => [{ path: ["inputs"], value: inputs.parse({ ...work.inputs, [key]: value }) }] },
    renderers: ({ h, kit }) => ({
      circuits: ({ page, readings, setPage }) => h("div", null, h(kit.Button, { label: "Manual case", onClick: () => setPage({ circuit: "manual" }) }, "Manual case"), ...(readings[roster]?.entries ?? []).map(row => h(kit.Button, { key: row.circuitUniqueId, label: row.loadName, "aria-pressed": page.circuit === row.circuitUniqueId, onClick: () => setPage({ circuit: row.circuitUniqueId }) }, row.loadName))),
      calculation: ({ work, readings, run, verbs }) => h("section", null, ...Object.entries(work?.inputs ?? {}).map(([key, value]) => h("label", { key }, key, h(kit.Input, { "aria-label": key, value, onChange: event => void run("input", { key, value: ["length", "amps", "voltage"].includes(key) ? Number(event.target.value) : event.target.value }) }))), h(kit.Input, { "aria-label": "Wire parameter intent and observed evidence", value: work?.wireIntent ?? "", onChange: e => void run("wireIntent", e.target.value) }), verbs({}), h("pre", { "aria-label": "Circuit calculation" }, JSON.stringify(readings[detail], null, 2))),
    }),
  };
}

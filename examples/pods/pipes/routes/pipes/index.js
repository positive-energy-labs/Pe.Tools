// One content-pinned module owns both the host catalog and the mounted route.
// TODO: Browser acceptance still owes fixture apply plus refreshed readback; the shared shell fixture lane currently refuses commands.
export const version = 2;
export const initial = { systemId: null, label: "" };
export const reducer = (state, event) => ({ ...state, ...event });
export function catalog({ z, workWriteCommand, writeIntentSchema }) {
  const route = "pod.pipes.pipes";
  const edit = z.object({ elementId: z.number().int(), parameterId: z.number().int(), value: z.string(), expected: z.record(z.string(), z.json()) });
  const work = { route, title: "Pipes", description: "Piping system parameter intent", schemaVersion: 2,
    schema: z.object({ version: z.literal(2).default(2), state: z.object({ systemId: z.number().nullable().default(null), label: z.string().default("") }).default(initial), writeIntent: writeIntentSchema.default({}) }),
    editable: [["writeIntent", "*"]],
    migrations: { 1: old => ({ ...old, version: 2, state: { ...initial, ...old.state }, writeIntent: old.writeIntent ?? {} }) },
  };
  const query = (says, input) => ({ axes: { subject: "Elements", touches: ["Metadata"], effect: "Read", cost: "Bounded", cardinality: "Many", cap: 200 }, says, input, needs: "document", effect: "query", dirties: [] });
  const entries = {
    "pod.pipes.roster": query("Read piping systems", z.object({}).default({})),
    "pod.pipes.detail": query("Read a piping system", z.object({ systemId: z.number().int() })),
    "pod.pipes.set-parameter": workWriteCommand(route, "pod.pipes.set-parameter", {
      axes: { subject: "Elements", touches: ["Metadata"], effect: "ModelWrite", cost: "Mutation", cardinality: "Many" }, says: "Set a pipe parameter", native: ["revit.apply.parameter-values"], needs: "document", effect: "command", dirties: ["snapshot"], input: edit,
    }),
  };
  return { work, entries, readings: {
    "pod.pipes.roster": () => ({}),
    "pod.pipes.detail": state => state.systemId ? { systemId: state.systemId } : null,
  } };
}
function authoredGraph({ pane }, work, directory) {
  return { key: work.route, name: "Pipes", address: directory.path.slice(1), directory,
    subject: () => "Piping system", work: work.schema, needs: "document", optionalTarget: undefined,
    fields: {}, readings: Object.fromEntries(["pod.pipes.roster", "pod.pipes.detail"].map(key => [key, { kind: "use", source: key, retire: "target" }])), verbs: {}, panes: { instrument: { label: "Pipes", purpose: "Inspect piping systems", draws: ["pod.pipes.roster", "pod.pipes.detail"], verbs: [] } },
    layout: pane("instrument"), stages: { inspect: { word: "Inspect", panes: ["instrument"], verbs: [], teach: "Read a piping system before staging parameter edits." } }, stageOrder: ["inspect"],
  };
}
const rosterScript = `public sealed class PipesRoster : PeScriptContainer {
 public override void Execute() {
  var systems = new Autodesk.Revit.DB.FilteredElementCollector(doc).OfClass(typeof(Autodesk.Revit.DB.Plumbing.PipingSystem)).Cast<Autodesk.Revit.DB.Plumbing.PipingSystem>();
  Result(new { rows = systems.Take(200).Select(s => new { id = s.Id.Value, name = s.Name }).ToArray() });
 }
}`;
export function registerHost(api) {
  const { work, entries } = catalog(api);
  const descriptor = api.descriptor;
  const directory = { path: `/tool/${encodeURIComponent(descriptor.key)}`, title: "Pipes", label: "Pipes", icon: "Boxes", category: "Ask / automate", blurb: work.description, aliases: ["piping", "system"], exposure: "Main", listed: true, runtimeNeed: "Revit", satellites: [], surfaces: { web: "full", pwa: "full", tray: false } };
  const operationKeys = { "pod.pipes.roster": "scripting.execute", "pod.pipes.detail": "revit.detail.elements", "pod.pipes.set-parameter": "revit.apply.parameter-values" };
  const derive = (key, input) => key.endsWith("roster")
    ? { scriptContent: rosterScript, workspaceKey: "workspaces/default", permissionMode: "ReadOnly", timeoutSeconds: 30 }
    : key.endsWith("detail") ? { query: { kind: "ElementReferences", elementIds: [input.systemId] } }
    : { edits: [{ elementId: input.elementId, parameterId: input.parameterId, value: input.value, expected: input.expected }], dryRun: false };
  const bodies = Object.fromEntries(Object.entries(entries).map(([key, definition]) => {
    return [key, api.operation({ key: operationKeys[key], definition,
      input: input => derive(key, input),
      retires: key.endsWith("set-parameter") ? result =>
        result?.dryRun === false && result?.applied === 1 && result?.results?.length === 1 && result.results[0].ok
          ? [["writeIntent", key]] : [] : undefined,
    })];
  }));
  return { version: 1, namespace: "pipes", key: `pipes:${work.route}`, moduleHash: descriptor.sha256,
    graph: authoredGraph(api, work, directory), work, entries, bodies };
}
export function register({ graph, adapters, pane }) {
  const authored = authoredGraph({ pane }, { route: graph.key, schema: graph.work }, graph.directory);
  return { graph: { ...graph, ...authored, fields: graph.fields, readings: graph.readings, verbs: graph.verbs }, adapters };
}
export function create(api) {
  return function Pipes() {
    const { state, fire } = api.useState();
    const [reading, setReading] = api.React.useState(null);
    const [intent, setIntent] = api.React.useState('{"elementId":0,"parameterId":0,"value":"","expected":{}}');
    const h = api.React.createElement;
    const run = action => async () => {
      try { setReading(await action()); }
      catch (error) { setReading({ error: String(error) }); }
    };
    return h("section", null,
      h(api.kit.Button, { label: "Read piping systems", onClick: run(() => api.read("pod.pipes.roster", {})) }, "Read piping systems"),
      h(api.kit.Input, { "aria-label": "Piping system id", type: "number", value: state.systemId ?? "", onChange: e => fire({ systemId: e.target.value ? Number(e.target.value) : null }) }),
      h(api.kit.Button, { label: "Read system", disabled: !state.systemId, onClick: run(() => api.read("pod.pipes.detail", { systemId: state.systemId })) }, "Read system"),
      h(api.kit.Input, { "aria-label": "Pipe parameter intent and observed evidence", value: intent, onChange: e => setIntent(e.target.value) }),
      h(api.kit.Button, { label: "Stage and preview", onClick: run(async () => { await api.stage("pod.pipes.set-parameter", JSON.parse(intent)); return api.do("pod.pipes.set-parameter", { previewOnly: true }); }) }, "Stage and preview"),
      h(api.kit.Button, { label: "Apply preview", onClick: run(() => api.do("pod.pipes.set-parameter", { previewOnly: false })) }, "Apply preview"),
      h("pre", { "aria-label": "Piping system reading" }, JSON.stringify(api.reading("pod.pipes.detail") ?? api.reading("pod.pipes.roster"), null, 2)),
      h("pre", null, reading === null ? "No piping system reading yet." : JSON.stringify(reading, null, 2)));
  };
}

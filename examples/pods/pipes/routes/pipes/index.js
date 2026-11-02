// One content-pinned module owns both the host catalog and the mounted route.
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
  const query = (says, input) => ({ says, input, needs: "document", effect: "query", dirties: [] });
  const entries = {
    "pod.pipes.roster": query("Read piping systems", z.object({}).default({})),
    "pod.pipes.detail": query("Read a piping system", z.object({ systemId: z.number().int() })),
    "pod.pipes.set-parameter": workWriteCommand(route, "pod.pipes.set-parameter", {
      says: "Set a pipe parameter", needs: "document", effect: "command", dirties: [], input: edit,
    }),
  };
  return { work, entries };
}
function authoredGraph({ pane }, work, directory) {
  return { key: work.route, name: "Pipes", address: directory.path.slice(1), directory,
    subject: () => "Piping system", work: work.schema, optionalTarget: "document",
    fields: {}, readings: {}, verbs: {}, panes: { instrument: { label: "Pipes", purpose: "Inspect piping systems", draws: [], verbs: [] } },
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
    : key.endsWith("detail") ? { query: { elementIds: [input.systemId] } }
    : { edits: [{ elementId: input.elementId, parameterId: input.parameterId, value: input.value, expected: input.expected }], dryRun: false };
  const bodies = Object.fromEntries(Object.entries(entries).map(([key, definition]) => {
    const native = api.operation(operationKeys[key]);
    return [key, { ...native, definition,
      bind: ctx => native.bind({ ...ctx, admission: { ...ctx.admission, key: operationKeys[key], input: derive(key, ctx.admission.input) } }),
    }];
  }));
  return { version: 1, namespace: "pipes", key: `pipes:${work.route}`, moduleHash: descriptor.sha256,
    graph: authoredGraph(api, work, directory), work, entries, bodies };
}
export function register({ graph, adapters }) {
  return { graph: { ...graph, subject: () => "Piping system" }, adapters };
}
export function create(api) {
  return function Pipes() {
    const { state, fire } = api.useState();
    const [reading, setReading] = api.React.useState(null);
    return api.React.createElement("section", null,
      api.React.createElement("button", { onClick: async () => setReading(await api.do("pod.pipes.roster", {})) }, "Read piping systems"),
      api.React.createElement("input", { "aria-label": "Piping system id", value: state.systemId ?? "", onChange: e => fire({ systemId: e.target.value ? Number(e.target.value) : null }) }),
      api.React.createElement("button", { disabled: !state.systemId, onClick: async () => setReading(await api.do("pod.pipes.detail", { systemId: state.systemId })) }, "Read system"),
      api.React.createElement("pre", null, JSON.stringify(reading, null, 2)));
  };
}

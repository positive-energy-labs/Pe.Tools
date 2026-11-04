// One registration authors the manifest, typed Work, operations and pane renderers.
export function register({ z, field, pane, split, workWriteCommands, writeIntentSchema, descriptor }) {
  const route = descriptor.workRoute;
  const write = "pod.pipes.set-parameter";
  const roster = "pod.pipes.roster", detail = "pod.pipes.detail";
  const edit = z.object({ elementId: z.number().int(), parameterId: z.number().int(), value: z.string(), expected: z.record(z.string(), z.json()) });
  const work = { route, title: "Pipes", description: "Piping system parameter intent", schemaVersion: 3,
    schema: z.object({ version: z.literal(3).default(3), writeIntent: writeIntentSchema.default({}), intent: z.string().default('{"elementId":0,"parameterId":0,"value":"","expected":{}}') }),
    editable: [["writeIntent", "*"], ["intent"]],
    migrations: { 1: old => ({ version: 2, writeIntent: old.writeIntent ?? {} }), 2: old => ({ version: 3, writeIntent: old.writeIntent ?? {} }) },
  };
  const query = (says, input) => ({ axes: { subject: "Elements", touches: ["Metadata"], effect: "Read", cost: "Bounded", cardinality: "Many", cap: 200 }, says, input, needs: "document", effect: "query", dirties: [] });
  const entries = {
    [roster]: query("Read piping systems", z.object({}).default({})),
    [detail]: query("Read a piping system", z.object({ uniqueId: z.string() })),
    ...workWriteCommands(route, write, { axes: { subject: "Elements", touches: ["Metadata"], effect: "ModelWrite", cost: "Mutation", cardinality: "Many" }, says: "Set a pipe parameter", native: ["revit.apply.parameter-values"], needs: "document", effect: "command", dirties: ["snapshot"], input: edit }),
  };
  const directory = { path: `/tool/${encodeURIComponent(descriptor.key)}`, title: "Pipes", label: "Pipes", icon: "Boxes", category: "Ask / automate", blurb: work.description, aliases: ["piping"], exposure: "Main", listed: true, runtimeNeed: "Revit", satellites: [], surfaces: { web: "full", pwa: "full", tray: false } };
  const graph = {
    key: route, name: "Pipes", address: directory.path.slice(1), directory, needs: "document", work: work.schema,
    subjectField: { field: "system", noun: "Piping system", keyKind: "UniqueId", cardinality: "one", roster, detail, pane: "systems", show: id => id },
    fields: { selected: { ...field(z.string().default(""), {}), role: "selection" }, system: { ...field(z.string().default(""), {}), role: "subject" } },
    readings: { [roster]: { kind: "use", source: roster, retire: "target" }, [detail]: { kind: "use", source: detail, retire: "page" } },
    verbs: { intent: { kind: "work", label: "Edit parameter intent", review: "none", input: z.string() }, stage: { kind: "work", label: "Stage parameter edit", review: "none", input: z.object({}).default({}) }, apply: { kind: "command", does: write, label: "Preview / apply parameter edit", review: "shown", input: z.object({}).default({}) } },
    panes: { systems: { label: "Piping systems", purpose: "Pick a piping system", draws: [roster], verbs: [] }, detail: { label: "System", purpose: "Inspect and edit the picked system", draws: [detail], verbs: ["stage", "apply"] }, history: { label: "History", purpose: "Inspect edits and receipts", draws: [], verbs: [], history: {} } },
    layout: split("pipes", { axis: "h", sized: "start", size: 260 }, pane("systems"), split("detail", { axis: "v", sized: "end", size: 160 }, pane("detail"), pane("history"))),
    stages: { inspect: { word: "Inspect", panes: ["systems", "detail", "history"], verbs: [], teach: "Pick a system, stage an edit, then inspect the sealed preview before applying." } }, stageOrder: ["inspect"],
    seeds: { sample: { title: "Piping system", load: async () => ({ page: { system: "" }, work: work.schema.parse({}), readings: { [roster]: { rows: [{ uniqueId: "pipe-system-1", name: "Heating water" }] }, [detail]: { name: "Heating water", value: "P-0" } }, target: { kind: "document", ref: { session: "fixture", openId: route } } }) } },
  };
  return { version: 1, namespace: descriptor.packageId, key: `${descriptor.packageId}:${route}`, moduleHash: descriptor.sha256, graph, work, entries,
    readings: { [roster]: () => ({}), [detail]: page => page.system ? { uniqueId: page.system } : null },
    edits: { intent: (_work, value) => [{ path: ["intent"], value }], stage: work => [{ path: ["writeIntent", write], value: { edit: { value: edit.parse(JSON.parse(work.intent)) } } }] },
    operations: {
      [roster]: { key: "scripting.execute", input: () => ({ scriptContent: rosterScript, workspaceKey: "workspaces/default", permissionMode: "ReadOnly", timeoutSeconds: 30 }) },
      [detail]: { key: "scripting.execute", input: input => ({ scriptContent: detailScript(input.uniqueId), workspaceKey: "workspaces/default", permissionMode: "ReadOnly", timeoutSeconds: 30 }) },
      [write]: { key: "revit.apply.parameter-values", input: input => ({ edits: [{ elementId: input.elementId, parameterId: input.parameterId, value: input.value, expected: input.expected }], dryRun: false }), retires: result => result?.dryRun === false && result?.applied === 1 && result?.results?.length === 1 && result.results[0].ok ? [["writeIntent", write]] : [] },
    },
    renderers: ({ h, kit }) => ({
      systems: ({ page, readings, setPage }) => h("div", null, ...(readings[roster]?.rows ?? []).map(row => h(kit.Button, { key: row.uniqueId, label: row.name, "aria-pressed": page.system === row.uniqueId, onClick: () => setPage({ system: row.uniqueId }) }, row.name))),
      detail: ({ work, readings, run, verbs }) => h("section", null,
        h("pre", { "aria-label": "Piping system reading" }, JSON.stringify(readings[detail], null, 2)),
        h(kit.Input, { "aria-label": "Pipe parameter intent and observed evidence", value: work?.intent ?? "", onChange: e => void run("intent", e.target.value) }),
        verbs({})),
    }),
  };
}
const rosterScript = `public sealed class PipesRoster : PeScriptContainer {
 public override void Execute() {
  var systems = new Autodesk.Revit.DB.FilteredElementCollector(doc).OfClass(typeof(Autodesk.Revit.DB.Plumbing.PipingSystem)).Cast<Autodesk.Revit.DB.Plumbing.PipingSystem>();
  Result(new { rows = systems.Take(200).Select(s => new { uniqueId = s.UniqueId, name = s.Name }).ToArray() });
 }
}`;
const detailScript = uniqueId => `public sealed class PipeDetail : PeScriptContainer {
 public override void Execute() { var element = doc.GetElement(${JSON.stringify(uniqueId)}); Result(element == null ? null : new { uniqueId = element.UniqueId, name = element.Name, id = element.Id.Value }); }
}`;

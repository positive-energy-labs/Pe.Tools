/**
 * The C# the /takeoff route runs inside Revit, through `scripting.execute`.
 *
 * This is the "scripts for awkward mutation" lane of CLAUDE.md, not a permanent home: every
 * builder here is one `takeoff.*` host operation that does not exist yet, written out longhand
 * so the pipeline is exercisable end-to-end today. Each is deliberately small and reads only
 * PUBLIC Pe.Revit.Takeoff surface — internals are invisible to the scripting compiler.
 *
 * Two rules the host enforces and these scripts obey:
 *   - WriteTransaction scripts must NOT open their own Transaction; the host owns it.
 *   - Structured data comes back as one `PE_JSON <json>` line on stdout (see host.ts).
 */

/** C# string-literal body: backslashes and quotes escaped, so the value survives into the script. */
const cs = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** C# list-of-string-literals body, e.g. `"FC-8", "FC-13"`. */
const csList = (values: string[]) => values.map((v) => `"${cs(v)}"`).join(", ");

/** `List<double[]>` literals for one zone's loops. Loops are embedded, never parsed in-script:
 *  Newtonsoft is not reachable from the scripting context. */
const csLoops = (loops: readonly (readonly (readonly [number, number])[])[]) =>
  loops
    .filter((loop) => loop.length >= 3)
    .map(
      (loop) =>
        `new List<double[]> { ${loop
          .map(([x, y]) => `new double[]{${x.toFixed(6)},${y.toFixed(6)}}`)
          .join(", ")} }`,
    )
    .join(", ");

const guidLiteral = (guid: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid))
    throw new Error(`not a GUID: ${guid}`);
  return guid;
};

// ── Step 0: what does the model already say? ────────────────────────────────

/**
 * Registry contents + a per-zone census of Room Region / held-residue FRs. Read-only; this is
 * how the zone board learns which zones are already materialized without partitioning anything.
 */
export const statusScript = () => `
var reg = Pe.Revit.Takeoff.TakeoffCarriers.ReadRegistry(doc);
var sb = new System.Text.StringBuilder();
Func<string, string> esc = s => (s ?? "").Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"");
sb.Append("{\\"doc\\":\\"").Append(esc(doc.Title)).Append("\\",\\"systems\\":[");
for (int i = 0; i < reg.Systems.Count; i++) {
  var s = reg.Systems[i];
  if (i > 0) sb.Append(",");
  sb.Append("{\\"guid\\":\\"").Append(s.Guid.ToString("D")).Append("\\",\\"tag\\":\\"").Append(esc(s.Tag)).Append("\\"}");
}
sb.Append("],\\"regions\\":[");
var counts = new Dictionary<string, int[]>();
foreach (var fr in new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()) {
  var ident = Pe.Revit.Takeoff.TakeoffCarriers.ReadIdentity(fr);
  if (ident.Role == null) continue;
  int slot = ident.Role == Pe.Revit.Takeoff.TakeoffCarriers.RoleRoomRegion ? 0
           : ident.Role == Pe.Revit.Takeoff.TakeoffCarriers.RoleHeldResidue ? 1 : -1;
  if (slot < 0) continue;
  var blob = Pe.Revit.Takeoff.TakeoffCarriers.ReadProvenance(fr);
  if (blob == null) continue;
  string zg;
  try { zg = Pe.Revit.Takeoff.RegionProvenance.FromJson(blob).ZoneGuid.ToString("D"); } catch { continue; }
  if (!counts.ContainsKey(zg)) counts[zg] = new int[2];
  counts[zg][slot]++;
}
bool first = true;
foreach (var kv in counts) {
  if (!first) sb.Append(",");
  first = false;
  sb.Append("{\\"zoneGuid\\":\\"").Append(kv.Key).Append("\\",\\"rooms\\":").Append(kv.Value[0]).Append(",\\"held\\":").Append(kv.Value[1]).Append("}");
}
sb.Append("]}");
WriteLine("PE_JSON " + sb.ToString());
`;

// ── Step 2: validate + register ─────────────────────────────────────────────

export interface RegistryArgs {
  /** Every System tag typed on any zone — the reconciliation's observed set. */
  observed: string[];
  /** Tags to mint GUIDs for. Already-registered tags are left alone. */
  register: string[];
  /** Explicit rename answers: an existing System keeps its GUID under a new tag. */
  renames: { guid: string; toTag: string }[];
}

/**
 * Writes the System registry (Project Information blob) and reports the reconciliation. The
 * rename-vs-new question is ASKED, never guessed — this script only applies renames the human
 * already answered, and returns the open questions for the board to render.
 */
export const registryScript = (args: RegistryArgs) => `
var observed = new List<string> { ${csList(args.observed)} };
var register = new List<string> { ${csList(args.register)} };
var renames = new List<string[]> { ${args.renames
  .map((r) => `new string[]{"${guidLiteral(r.guid)}", "${cs(r.toTag)}"}`)
  .join(", ")} };
Func<string, string> esc = s => (s ?? "").Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"");
{
  Pe.Revit.Takeoff.TakeoffCarriers.EnsureBindings(doc);
  var reg = Pe.Revit.Takeoff.TakeoffCarriers.ReadRegistry(doc);
  foreach (var pair in renames) reg.Rename(new Guid(pair[0]), pair[1]);
  foreach (var tag in register) if (reg.FindByTag(tag) == null) reg.Register(tag);
  Pe.Revit.Takeoff.TakeoffCarriers.WriteRegistry(doc, reg);
}
var after = Pe.Revit.Takeoff.TakeoffCarriers.ReadRegistry(doc);
var rec = after.Reconcile(observed);
var sb = new System.Text.StringBuilder();
sb.Append("{\\"systems\\":[");
for (int i = 0; i < after.Systems.Count; i++) {
  var s = after.Systems[i];
  if (i > 0) sb.Append(",");
  sb.Append("{\\"guid\\":\\"").Append(s.Guid.ToString("D")).Append("\\",\\"tag\\":\\"").Append(esc(s.Tag)).Append("\\"}");
}
sb.Append("],\\"appeared\\":[");
for (int i = 0; i < rec.Appeared.Count; i++) { if (i > 0) sb.Append(","); sb.Append("\\"").Append(esc(rec.Appeared[i])).Append("\\""); }
sb.Append("],\\"vanished\\":[");
for (int i = 0; i < rec.Vanished.Count; i++) {
  if (i > 0) sb.Append(",");
  sb.Append("{\\"guid\\":\\"").Append(rec.Vanished[i].Guid.ToString("D")).Append("\\",\\"tag\\":\\"").Append(esc(rec.Vanished[i].Tag)).Append("\\"}");
}
sb.Append("],\\"renameCandidates\\":[");
for (int i = 0; i < rec.RenameCandidates.Count; i++) {
  var c = rec.RenameCandidates[i];
  if (i > 0) sb.Append(",");
  sb.Append("{\\"fromGuid\\":\\"").Append(c.From.Guid.ToString("D")).Append("\\",\\"fromTag\\":\\"").Append(esc(c.From.Tag)).Append("\\",\\"toTag\\":\\"").Append(esc(c.To)).Append("\\"}");
}
sb.Append("],\\"needsHuman\\":").Append(rec.NeedsHuman ? "true" : "false").Append("}");
WriteLine("PE_JSON " + sb.ToString());
`;

// ── Step 3: partition one zone ──────────────────────────────────────────────

export interface PartitionArgs {
  replayPath: string;
  view: string;
  levelFragment: string;
  zoneName: string;
  zoneGuid: string;
  runId: string;
  loops: readonly (readonly (readonly [number, number])[])[];
}

/**
 * The rerun unit. Replays the level-wide capture masked to this zone's declared loops, then
 * materializes accepted rooms and held residue into the real zoning view. Reruns re-bind by
 * geometry and never touch an existing region — propose, never overwrite.
 *
 * seam: TakeoffPromotion.PromoteZone (the per-zone editability gate) is internal and not
 * reachable from scripting, so what lands here is the raw detector partition.
 */
export const partitionScript = (args: PartitionArgs) => `
var loops = new List<List<double[]>> { ${csLoops(args.loops)} };
Func<string, string> esc = s => (s ?? "").Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"");
Func<double, string> num = d => d.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture);

var zone = new Pe.Revit.Takeoff.ZoneScope { Name = "${cs(args.zoneName)}", Loops = loops };
var snap = Pe.Revit.Takeoff.DetectSnapshot.Load(
    Environment.ExpandEnvironmentVariables("${cs(args.replayPath)}"));
var result = snap.ReplayInferred(s => { }, null, zone.CellMask(snap.Field));

var view = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
    .FirstOrDefault(v => !v.IsTemplate && v.Name == "${cs(args.view)}");
if (view == null) throw new InvalidOperationException("no ViewPlan named '${cs(args.view)}'");
var level = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
    .FirstOrDefault(l => l.Name.IndexOf("${cs(args.levelFragment)}", StringComparison.OrdinalIgnoreCase) >= 0);
double elevation = level != null ? level.Elevation : snap.LevelElevation;

var zoneGuid = new Guid("${guidLiteral(args.zoneGuid)}");
var mat = Pe.Revit.Takeoff.ZoneMaterializer.Materialize(
    doc, view, elevation, zoneGuid, "${cs(args.runId)}", result.Rooms, result.Residues, s => { });

// Newly created FilledRegions are not in the collector index until the document regenerates.
doc.Regenerate();
var sb = new System.Text.StringBuilder();
sb.Append("{\\"levelName\\":\\"").Append(esc(result.LevelName)).Append("\\"");
sb.Append(",\\"elevation\\":").Append(num(elevation));
sb.Append(",\\"created\\":").Append(mat.Created).Append(",\\"held\\":").Append(mat.Held);
sb.Append(",\\"rebound\\":").Append(mat.Rebound).Append(",\\"orphaned\\":").Append(mat.Orphaned);
sb.Append(",\\"domainSqft\\":").Append(num(result.DomainSqft));
sb.Append(",\\"claimedWallSqft\\":").Append(num(result.ClaimedWallSqft));
sb.Append(",\\"excludedResidueSqft\\":").Append(num(result.ExcludedResidueSqft));
sb.Append(",\\"totalSqft\\":").Append(num(result.TotalSqft));
sb.Append(",\\"profile\\":\\"").Append(esc(result.ProfileProvenance)).Append("\\"");
sb.Append(",\\"failures\\":[");
for (int i = 0; i < mat.Failures.Count; i++) { if (i > 0) sb.Append(","); sb.Append("\\"").Append(esc(mat.Failures[i])).Append("\\""); }
sb.Append("],\\"rooms\\":[");
for (int i = 0; i < result.Rooms.Count; i++) {
  var r = result.Rooms[i];
  if (i > 0) sb.Append(",");
  sb.Append("{\\"id\\":\\"").Append(esc(r.Id)).Append("\\",\\"rawSqft\\":").Append(num(r.RawSqft));
  sb.Append(",\\"perimeterFt\\":").Append(num(r.PerimeterFt));
  sb.Append(",\\"meanCeilingFt\\":").Append(num(r.MeanCeilingFt));
  sb.Append(",\\"label\\":[").Append(num(r.LabelX)).Append(",").Append(num(r.LabelY)).Append("]");
  sb.Append(",\\"flags\\":[");
  for (int f = 0; f < r.Flags.Count; f++) { if (f > 0) sb.Append(","); sb.Append("\\"").Append(esc(r.Flags[f])).Append("\\""); }
  sb.Append("],\\"outer\\":[");
  for (int p = 0; p < r.Polygon.Count; p++) { if (p > 0) sb.Append(","); sb.Append("[").Append(num(r.Polygon[p][0])).Append(",").Append(num(r.Polygon[p][1])).Append("]"); }
  sb.Append("]}");
}
sb.Append("],\\"residues\\":[");
for (int i = 0; i < result.Residues.Count; i++) {
  var r = result.Residues[i];
  if (i > 0) sb.Append(",");
  sb.Append("{\\"id\\":\\"").Append(esc(r.Id)).Append("\\",\\"reason\\":\\"").Append(r.Reason.ToString()).Append("\\"");
  sb.Append(",\\"rawSqft\\":").Append(num(r.RawSqft));
  sb.Append(",\\"label\\":[").Append(num(r.LabelX)).Append(",").Append(num(r.LabelY)).Append("]");
  sb.Append(",\\"outer\\":[");
  for (int p = 0; p < r.Polygon.Count; p++) { if (p > 0) sb.Append(","); sb.Append("[").Append(num(r.Polygon[p][0])).Append(",").Append(num(r.Polygon[p][1])).Append("]"); }
  sb.Append("]}");
}
sb.Append("],\\"regions\\":");
${REGIONS_FRAGMENT}
sb.Append("}");
WriteLine("PE_JSON " + sb.ToString());
`;

/** Shared tail: every Room Region / held-residue FR of one zone, with its provenance blob. */
function regionsFragment() {
  return `
{
  var rsb = new System.Text.StringBuilder();
  rsb.Append("[");
  bool rfirst = true;
  foreach (var role in new[] { Pe.Revit.Takeoff.TakeoffCarriers.RoleRoomRegion, Pe.Revit.Takeoff.TakeoffCarriers.RoleHeldResidue })
  foreach (var e in Pe.Revit.Takeoff.ZoneMaterializer.ReadExisting(doc, view, zoneGuid, role)) {
    if (!rfirst) rsb.Append(",");
    rfirst = false;
    var fr = doc.GetElement(new ElementId(e.ElementId)) as FilledRegion;
    string blob = fr == null ? "" : (Pe.Revit.Takeoff.TakeoffCarriers.ReadProvenance(fr) ?? "");
    rsb.Append("{\\"elementId\\":").Append(e.ElementId).Append(",\\"role\\":\\"").Append(role).Append("\\"");
    rsb.Append(",\\"guid\\":\\"").Append(e.Guid.ToString("D")).Append("\\",\\"sqft\\":").Append(num(e.Sqft));
    rsb.Append(",\\"blob\\":\\"").Append(esc(blob)).Append("\\",\\"outer\\":[");
    for (int p = 0; p < e.Polygon.Count; p++) { if (p > 0) rsb.Append(","); rsb.Append("[").Append(num(e.Polygon[p][0])).Append(",").Append(num(e.Polygon[p][1])).Append("]"); }
    rsb.Append("]}");
  }
  rsb.Append("]");
  sb.Append(rsb.ToString());
}`;
}

const REGIONS_FRAGMENT = regionsFragment();

/** Read-only twin of the partition tail: what is materialized for a zone, without rerunning. */
export const zoneRegionsScript = (args: { view: string; zoneGuid: string }) => `
Func<string, string> esc = s => (s ?? "").Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"");
Func<double, string> num = d => d.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture);
var view = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
    .FirstOrDefault(v => !v.IsTemplate && v.Name == "${cs(args.view)}");
if (view == null) throw new InvalidOperationException("no ViewPlan named '${cs(args.view)}'");
var zoneGuid = new Guid("${guidLiteral(args.zoneGuid)}");
var sb = new System.Text.StringBuilder();
sb.Append("{\\"regions\\":");
${REGIONS_FRAGMENT}
sb.Append("}");
WriteLine("PE_JSON " + sb.ToString());
`;

// ── The write-through review law ────────────────────────────────────────────

/**
 * Persists the decision list onto its datum's home — the Room Region's provenance blob — at
 * decision time. The blob is a dumb pipe (TakeoffCarriers), so the resolutions ride alongside
 * the v1 RegionProvenance fields; the script re-reads and re-parses afterwards, so a splice
 * that would break the fail-closed codec fails the call instead of corrupting the region.
 */
export const decisionScript = (args: { elementId: number; resolutionsJson: string }) => `
var fr = doc.GetElement(new ElementId(${Math.trunc(args.elementId)}L)) as FilledRegion;
if (fr == null) throw new InvalidOperationException("element ${Math.trunc(args.elementId)} is not a FilledRegion");
string blob = Pe.Revit.Takeoff.TakeoffCarriers.ReadProvenance(fr);
if (string.IsNullOrEmpty(blob)) throw new InvalidOperationException("region carries no provenance blob");
int cut = blob.IndexOf(",\\"resolutions\\":", StringComparison.Ordinal);
string head = cut >= 0 ? blob.Substring(0, cut) : blob.TrimEnd().Substring(0, blob.TrimEnd().Length - 1);
string next = head + ",\\"resolutions\\":" + "${cs(args.resolutionsJson)}" + "}";
Pe.Revit.Takeoff.TakeoffCarriers.WriteProvenance(fr, next);
var check = Pe.Revit.Takeoff.RegionProvenance.FromJson(Pe.Revit.Takeoff.TakeoffCarriers.ReadProvenance(fr));
WriteLine("PE_JSON {\\"elementId\\":${Math.trunc(args.elementId)},\\"zoneGuid\\":\\"" + check.ZoneGuid.ToString("D") + "\\",\\"bytes\\":" + next.Length + "}");
`;

/** W0-A: can raw connectors plus a 36-inch candidate search recover the asserted MUAS path? */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { friction, sectionOf } from "../src/loss-physics.ts";
import { lookupGrid, type Grid, type Grids } from "../src/loss-grid.ts";
import { LOSS_RULES, type FittingFacts } from "../src/loss-rules.ts";

type Vec = [number, number, number];
type Size = { shape: string; size?: string; diameterIn?: number; widthIn?: number; heightIn?: number };
type Connector = Size & { index: number; kind: string; point: Vec; facing?: Vec; direction?: string;
  classification?: string; connectedTo?: { elementId: number; connector: number } };
type Element = Partial<Size> & { id: number; kind: string; category?: string; family?: string;
  type?: string; partType?: string; lengthFt?: number; systemName?: string; connectors: Connector[];
  facts?: { key: string; value?: number; text?: string }[] };
type Visit = { id: number; entry?: number; exit?: number; via?: "native" | "inferred" };
type Candidate = { fromElement: number; fromConnector: number; toElement: number; toConnector: number;
  gapIn: number; facingDot: number | null; opposes: boolean; occupied: boolean; crossClass: boolean };
type End = { kind: string; at: string; path: Visit[] };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const input = process.argv[2] ?? "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-raw.json";
const output = process.argv[3] ?? "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/runs/ducts-sheet-20261027/W0-A-spike.md";
const MUAS = 14577391, FC = 13760867, DH = 13770619, LOUVER = 14088043;
const Q = 150, MAX_FT = 3;
const start = performance.now();
const bytes = readFileSync(input);
const readMs = performance.now() - start;
const parseStart = performance.now();
const envelope = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
assert.equal(envelope.ok, true);
const raw = envelope.result;
const parseMs = performance.now() - parseStart;
// Deliberately never read groups, issues, flow records, fan election, or the old route.
const indexStart = performance.now();
const elements: Element[] = [...raw.nodes, ...raw.segments];
const byId = new Map(elements.map(e => [e.id, e]));
assert.equal(byId.size, elements.length, "duplicate element ids");
const mepKinds = new Set(["duct", "flex", "fitting", "cap", "accessory", "equipment", "terminal"]);
const ports = elements.filter(e => mepKinds.has(e.kind)).flatMap(e => e.connectors.map(c => ({ e, c })));
for (const { e, c } of ports) {
  assert(c.point.length === 3 && c.point.every(Number.isFinite), `bad point ${e.id}:${c.index}`);
  assert.equal(e.connectors.filter(x => x.index === c.index).length, 1, "duplicate connector index");
}
const indexMs = performance.now() - indexStart;
const get = (id: number) => { const e = byId.get(id); assert(e, `element absent ${id}`); return e; };
const connector = (id: number, index: number) => get(id).connectors.find(c => c.index === index);
const key = (id: number, c: Connector) => `${id}:${c.index}`;
const distance = (a: Vec, b: Vec) => Math.hypot(...a.map((v, i) => v - b[i]!));
const dot = (a?: Vec, b?: Vec): number | null => a && b && Math.hypot(...a) && Math.hypot(...b)
  ? a.reduce((n, v, i) => n + v * b[i]!, 0) / Math.hypot(...a) / Math.hypot(...b) : null;
const crossing = (a: Connector, b: Connector) => !!a.classification && !!b.classification && a.classification !== b.classification;
const fact = (e: Element, name: string) => e.facts?.find(f => f.key === name)?.value ?? null;
const mark = (e: Element) => e.facts?.find(f => f.key === "mark")?.text ?? "";
const name = (e: Element) => [e.family, e.type, mark(e)].filter(Boolean).join(" / ");
for (const id of [MUAS, FC, DH, LOUVER]) get(id);
assert.equal(mark(get(MUAS)), "MUAS-1");
assert.equal(mark(get(FC)), "FC-23");
assert.equal(mark(get(DH)), "DH-20");

function candidates(e: Element, c: Connector): Candidate[] {
  return ports.flatMap(({ e: other, c: d }) => {
    if (other.id === e.id || distance(c.point, d.point) > MAX_FT) return [];
    const facingDot = dot(c.facing, d.facing);
    return [{ fromElement: e.id, fromConnector: c.index, toElement: other.id, toConnector: d.index,
      gapIn: 12 * distance(c.point, d.point), facingDot, opposes: facingDot != null && facingDot <= -0.9,
      occupied: !!d.connectedTo, crossClass: crossing(c, d) }];
  }).sort((a, b) => Number(b.opposes) - Number(a.opposes) || a.gapIn - b.gapIn || a.toElement - b.toElement || a.toConnector - b.toConnector);
}

function walk(port: number, infer: boolean, strict = false, blockMultiport = false) {
  const began = performance.now();
  const first = connector(MUAS, port)!;
  const queue = [{ id: MUAS, out: first, path: [{ id: MUAS, exit: port }] as Visit[] }];
  const visited = new Set<string>();
  const ends: End[] = [];
  const witnesses = new Map<number, Visit[]>();
  const opens = new Map<string, { id: number; connector: number; point: Vec; path: Visit[];
    candidates: Candidate[]; chosen?: Candidate }>();
  const joins = new Map<string, Candidate>();
  const classChanges = new Set<string>();
  const multiport = new Set<number>();
  const nonreciprocal = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { id, out, path } = queue[cursor]!;
    let target = out.connectedTo;
    let via: Visit["via"] = "native";
    if (!target) {
      const k = key(id, out);
      let open = opens.get(k);
      if (!open) {
        const options = infer ? candidates(get(id), out) : [];
        const chosen = strict ? options.find(x => x.opposes && !x.occupied && !x.crossClass) : options[0];
        open = { id, connector: out.index, point: out.point, path, candidates: options, chosen };
        opens.set(k, open);
      }
      if (!open.chosen) { ends.push({ kind: "open-end", at: k, path }); continue; }
      joins.set(k, open.chosen);
      target = { elementId: open.chosen.toElement, connector: open.chosen.toConnector };
      via = "inferred";
    }
    const e = byId.get(target.elementId);
    const entry = e?.connectors.find(c => c.index === target.connector);
    if (!e || !entry) { ends.push({ kind: "missing-reference", at: `${target.elementId}:${target.connector}`, path }); continue; }
    const nextPath = [...path, { id: e.id, entry: entry.index, via }];
    if (!witnesses.has(e.id)) witnesses.set(e.id, nextPath);
    const state = key(e.id, entry);
    if (crossing(out, entry)) classChanges.add(`${key(id, out)} -> ${state}`);
    if (via === "native" && (entry.connectedTo?.elementId !== id || entry.connectedTo?.connector !== out.index))
      nonreciprocal.add(`${key(id, out)} -> ${state}`);
    if (visited.has(state)) { ends.push({ kind: "rejoin", at: state, path: nextPath }); continue; }
    visited.add(state);
    const stop = e.id === FC ? "roster-fan-port" : e.id === MUAS ? "source-fan-return" : e.kind === "terminal" ? "terminal" : null;
    if (stop) { ends.push({ kind: stop, at: state, path: nextPath }); continue; }
    if (e.kind === "equipment" && e.connectors.length > 2) {
      multiport.add(e.id);
      if (blockMultiport) { ends.push({ kind: "ambiguous-equipment", at: state, path: nextPath }); continue; }
    }
    const exits = e.connectors.filter(c => c.index !== entry.index);
    if (!exits.length) ends.push({ kind: e.kind === "cap" ? "sealed-cap" : "no-through-port", at: state, path: nextPath });
    for (const exit of exits) {
      if (crossing(entry, exit)) classChanges.add(`${state} THROUGH ${e.id} -> ${key(e.id, exit)}`);
      queue.push({ id: e.id, out: exit, path: [...path, { id: e.id, entry: entry.index, exit: exit.index, via }] });
    }
  }
  return { port, infer, ms: performance.now() - began, visited: visited.size, ends, witnesses,
    opens: [...opens.values()], joins: [...joins.values()], classChanges: [...classChanges],
    multiport: [...multiport], nonreciprocal: [...nonreciprocal] };
}
const A = [walk(1, false), walk(2, false)];
const B = [walk(1, true), walk(2, true)];
const noMultiport = [walk(1, false, false, true), walk(2, false, false, true)];
const strictB = [walk(1, true, true), walk(2, true, true)];
type Walk = ReturnType<typeof walk>;

// Only parse the small, retained physics fixtures. Missing tables stay unpriced; no Revit installation read.
const tableDir = resolve(ROOT, "dotnet/Pe.Shared.Tests/RevitData/Fixtures/Ashrae");
const grids: Grids = {};
const tableSources: string[] = [];
for (const [table, file] of [["CD3-2", "Cd3-2.tbl"], ["SD5-9", "Sd5-9.tbl"], ["SD4-2", "Sd4-2.tbl"], ["SR4-3", "Sr4-3.tbl"]]) {
  const p = resolve(tableDir, file!);
  if (!existsSync(p)) continue;
  const text = readFileSync(p, "latin1");
  tableSources.push(`${p} SHA256 ${createHash("sha256").update(text, "latin1").digest("hex")}`);
  grids[table!] = {};
  for (const block of text.split(/^={3,}\s*$/m)) {
    const lines = block.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
    if (!lines[0]?.startsWith(table!)) continue;
    const values = (s: string) => s.trim().split(/\s+/).map(t => Number(t.replace(/\(.*\)/, "")));
    const arrow = lines.findIndex(s => s.includes("->"));
    let result = "Co", grid: Grid;
    if (arrow >= 0) {
      result = lines[arrow - 1]!.trim();
      const [xLabel, axis] = lines[arrow]!.split("->");
      const rows = lines.slice(arrow + 2).filter(s => /^-?\d/.test(s)).map(values);
      grid = { title: lines[0]!, xLabel: xLabel!, x: values(axis!), yLabel: lines[arrow + 1]!,
        y: rows.map(r => r[0]!), grid: rows.map(r => r.slice(1)) };
      assert(rows.every(r => r.length === grid.x.length + 1));
    } else {
      const axis = lines.find(s => s.startsWith("D,"));
      const row = lines.find(s => s.startsWith("Co"));
      assert(axis && row, `unsupported fixture ${table}`);
      grid = { title: lines[0]!, xLabel: "D,in", x: values(axis.replace(/^D,\s+in\.\(mm\)\s+/, "")),
        grid: values(row.replace(/^Co\s+/, "")) };
      assert.equal(grid.x.length, grid.grid.length);
    }
    assert(grid.x.every(Number.isFinite));
    assert(grid.x.every((v, i) => i === 0 || v > grid.x[i - 1]!));
    assert(!grid.y || grid.y.every((v, i) => i === 0 || v > grid.y![i - 1]!));
    grids[table!]![result] = grid;
  }
}
assert.equal(lookupGrid(grids["CD3-2"]!.Co!, 10).value, 0.24);
assert.equal(lookupGrid(grids["SD5-9"]!.Cb!, 1, 1).value, 1.2);
assert.equal(lookupGrid(grids["SD5-9"]!.Cs!, 1, 1).value, 0.13);
const section = (s?: Partial<Size>) => s?.shape ? sectionOf(s.shape, s.diameterIn, s.widthIn, s.heightIn) : null;
const rulePort = (c: Connector) => ({ ...c, section: section(c) });

function price(path: Visit[], inletSide: boolean) {
  return path.filter(v => v.id !== MUAS).map(v => {
    const e = get(v.id);
    // Intake walk runs against assumed airflow: its exit is the physical inlet.
    const incoming = connector(e.id, (inletSide ? v.exit : v.entry) ?? v.entry ?? v.exit ?? -1);
    const outgoing = connector(e.id, (inletSide ? v.entry : v.exit) ?? -1);
    const s = section(incoming) ?? section(e);
    let loss: number | null = null, rule = "unpriced", reason = "no equipment/terminal drop supplied";
    const velocity = s ? Q / s.areaFt2 : null;
    if (["duct", "flex"].includes(e.kind) && s && e.lengthFt != null) {
      loss = friction(s, Q, e.lengthFt).dp;
      rule = "Altshul-Tsal; roughness ASSUMED 0.0003 ft";
      reason = "full element length; branch-to-branch duct distances not apportioned";
    } else if (["fitting", "accessory"].includes(e.kind) && incoming && outgoing) {
      const mainId = fact(e, "mainSegment"), main = mainId ? byId.get(mainId) : undefined;
      const mainConnector = main?.connectors.find(c => c.kind === "end");
      const f: FittingFacts = { kind: e.kind as "fitting" | "accessory", family: e.family ?? null,
        partType: e.partType ?? null, rOverD: fact(e, "rOverD"), angleDeg: fact(e, "angle"),
        aoOverA1: section(outgoing) && section(incoming) ? section(outgoing)!.areaFt2 / section(incoming)!.areaFt2 : null,
        inlet: rulePort(incoming), outlet: rulePort(outgoing), main: mainConnector ? rulePort(mainConnector) : null,
        abOverAc: fact(e, "abOverAc"), takeoff: fact(e, "takeoff") === 1 };
      // No flow conservation claim: the requested spike assumes 150 cfm on every leg.
      const flows = { q: Q, qb: Q, qc: Q, qs: Q };
      const selected = LOSS_RULES.find(r => r.when(f, flows));
      reason = selected ? `missing retained grid ${selected.table}` : "no loss rule matches raw facts";
      if (selected) {
        rule = `unpriced (${selected.key}/${selected.table})`;
        // SD5-9 is diverging. Do not apply its branch coefficient backwards on a collecting tap.
        if (f.takeoff && outgoing.connectedTo?.elementId === mainId) reason = "collecting tap; retained SD5-9 rule is diverging";
        else {
          if (f.takeoff) f.inlet = rulePort(outgoing);
          const leg = f.takeoff ? "Cb" : "C";
          const args = selected.input(f, flows, selected.table, leg);
          const grid = grids[selected.table]?.[args.res];
          if (grid) {
            try {
              const lookup = lookupGrid(grid, args.x, args.y);
              const basis = selected.basisOf(f, flows, leg);
              if (basis.section) {
                loss = lookup.value * friction(basis.section, basis.cfm, 0).pv;
                rule = `${selected.key}/${selected.table}/${args.res}; C=${lookup.value}`;
                reason = [lookup.inputs, ...lookup.notes, f.takeoff ? "ASSUMED qb=qc=qs=150; not balanced" : "",
                  e.partType === "Elbow" && Math.abs((fact(e, "angle") ?? 90) - 90) > 0.1 ? "90-degree table used by raw rule; no angle correction" : ""].filter(Boolean).join("; ");
              }
            } catch (error) { reason = String(error); }
          }
        }
      }
    }
    return { id: e.id, kind: e.kind, familyType: name(e), lengthFt: e.lengthFt ?? null,
      size: incoming?.size ?? e.size ?? "unknown", velocity, loss, rule, reason };
  });
}

const sha = createHash("sha256").update(bytes).digest("hex");
const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const commit = git(["rev-parse", "HEAD"]);
const script = fileURLToPath(import.meta.url);
const scriptHash = createHash("sha256").update(readFileSync(script)).digest("hex");
const when = new Date().toISOString();
const fmt = (v: unknown) => v == null ? "—" : typeof v === "number" ? Number(v.toFixed(6)).toString() : String(v).replaceAll("|", "\\|").replaceAll("\n", " ");
const table = (head: string[], rows: unknown[][]) => [head, head.map(() => "---"), ...rows].map(r => `| ${r.map(fmt).join(" | ")} |`).join("\n");
const chain = (path: Visit[]) => path.map(v => `${v.id}[${v.entry ?? "start"}>${v.exit ?? "end"}]${v.via === "inferred" ? "*" : ""}`).join(" → ");
const has = (w: Walk, id: number) => w.witnesses.has(id);
const plenumPoint: Vec = [479, 680.5, 19.2];
const plenums = elements.filter(e => e.widthIn === 30 && e.heightIn === 30)
  .map(e => ({ e, ft: Math.min(...e.connectors.map(c => distance(c.point, plenumPoint))) })).sort((a, b) => a.ft - b.ft);
const capGap = 12 * distance(connector(14122436, 1)!.point, connector(14106988, 1)!.point);
assert(Math.abs(capGap - 2.628) < 0.001);
assert.equal(A[1]!.ends.filter(e => e.kind === "open-end").length, 1);
assert.equal(A[1]!.ends.find(e => e.kind === "open-end")!.at, "14122436:1");
assert.equal(B[1]!.opens.find(e => e.id === 14122436)?.chosen?.toElement, 14106988);
assert.equal(has(B[1]!, LOUVER), true);
assert.equal(has(noMultiport[0]!, LOUVER), false);
assert.equal(has(noMultiport[0]!, FC), true);
assert.equal(has(noMultiport[0]!, DH), true);
assert.equal(has(strictB[1]!, LOUVER), false);

const report: string[] = ["# W0-A: MUAS-1 raw-snapshot falsifying spike", "",
  `PROVEN[deterministic, ${input}, ${commit} (script SHA256 ${scriptHash}), ${when}]`, "",
  "The 36-inch candidate search discovers the plenum and reaches the louver in the permissive graph. It does not prove a physical plenum-cap join: the selected plenum connector is already occupied by the cap. A vacant-port-only sensitivity leaves discharge open.", "",
  "FALSIFIED[deterministic, treating unrestricted equipment pass-through as a trustworthy air path]. The saved connector gap is 2.628 inches and does not reproduce the cited 1.63-inch gap. A surface offset could explain the difference, but the surface-gap claim is UNPROVEN because no cap-face geometry exists in this input. The inlet reaches the louver only when multiport equipment is treated as all-to-all.", "",
  "UNPROVEN[physical air-path continuity, louver containment inside a plenum, required ESP, and reconciliation with the red-route image or .r10: neither reference file was supplied to this spike]. Raw acquisition sufficiency survives this membership test; safe inference and multiport pairing do not. This does not prove that Space is necessary or unnecessary.", "",
  "## Input and method", "", `Input: ${input}; ${bytes.length} bytes (${(bytes.length / 1e6).toFixed(3)} MB). SHA256 ${sha}.`,
  `Document: ${JSON.stringify(raw.document)}. ${elements.length} unique elements; ${ports.length} MEP connectors. Coordinate unit: feet, assumed from snapshot contract.`,
  `Checkout: ${ROOT}; branch ${git(["branch", "--show-current"])}; base/head ${commit}. Script: ${script}.`,
  "Command from checkout: `pnpm -C ts exec tsx packages/ducts-domain/spike/walk-spike.ts` (optional positional input and report paths).",
  "This checkout has tsx 4.23.0 installed transitively but no workspace tsx command shim. Actual run: `pnpm -C ts exec node node_modules/.pnpm/tsx@4.23.0/node_modules/tsx/dist/cli.mjs packages/ducts-domain/spike/walk-spike.ts`. No dependency installation or package configuration change. The first parser assertion caught splitting on the equals sign in a table title; splitting now accepts only separator lines.",
  "A follows explicit connectedTo only. B queries every other MEP element with a connector inside a Euclidean 3-ft radius (a cube alone would admit more). Caps and accessories count as duct fittings/accessories. It prefers normalized facingDot <= -0.9, then distance, then element/connector id; without an opposed face it takes the nearest and flags it. It deliberately permits occupied ports and cross-class joins to expose the requested broad candidate rule. No system name, direction or group chooses an edge. Port 1 is caller-asserted intake; port 2 discharge, consistent with metadata but not inferred from it.",
  "Each element passes entry to every other connector, including curve taps. FC-23 stops at the encountered port; MUAS-1 returns stop without traversing the fan. Terminals stop. A cap with no onward port is a sealed-cap, never an open connector. Missing references are explicit. BFS expands each (element, incoming connector) once. Tables retain ordered first-discovery chains and rejoin witnesses; no reachable state is truncated, but all combinatorial simple paths are not enumerated. This spike is not the future hydraulic path engine.",
  "All raw open ends are retained even when B infers a continuation. * after an element in a chain marks inferred arrival. An already occupied target is an inference blocker, not a healed connector. Multiport all-to-all traversal and classification changes are recorded; neither establishes an equipment's internal air-stream pairing.", "",
  "## Named elements", "", table(["Id", "Kind", "Family / type / mark", "Ports"], [MUAS, FC, DH, LOUVER, 14577396, 14577394, 14607308, 14107111].map(id => { const e = get(id); return [id, e.kind, name(e), e.connectors.map(c => key(id, c)).join(", ")]; })), "",
  "30x30 ducts, ordered by nearest connector to requested point; the nearest is 3.132 ft away, not within the 3-ft candidate radius around that approximate point. The search at the actual open end does include it.", "",
  table(["Duct id", "Nearest connector distance ft", "Length ft", "Connector points"], plenums.map(({ e, ft }) => [e.id, ft, e.lengthFt, e.connectors.map(c => `${c.index}: ${JSON.stringify(c.point)}`).join("; ")])), "",
  "## Timing", "", table(["Operation", "Milliseconds", "Scope"], [["read", readMs, "full file; OS cache uncontrolled"], ["JSON parse", parseMs, "full file"], ["index / coordinate validation", indexMs, "all elements"], ...[...A, ...B].map(w => [`${w.infer ? "B" : "A"} port ${w.port}`, w.ms, `${w.visited} entry states; includes all candidate scans for B`]), ["A end-to-end", readMs + parseMs + indexMs + A.reduce((n, w) => n + w.ms, 0), "shared read/parse/index plus both A walks"], ["B end-to-end", readMs + parseMs + indexMs + B.reduce((n, w) => n + w.ms, 0), "shared read/parse/index plus both B walks"]]),
  "One measured run, not a cold-I/O benchmark. Pricing, report formatting, and sensitivity runs are excluded from walk time.", ""];

for (const [label, walks] of [["A", A], ["B", B]] as const) {
  report.push(`## Walk ${label}`, "", table(["Port", "Reachable elements", "Entry states", "Ends by kind", "Open connectors", "Multiport equipment", "Class changes", "Nonreciprocal native links"], walks.map(w => [w.port, w.witnesses.size, w.visited, JSON.stringify(w.ends.reduce<Record<string, number>>((a, e) => { a[e.kind] = (a[e.kind] ?? 0) + 1; return a; }, {})), w.opens.length, w.multiport.join(", "), w.classChanges.length, w.nonreciprocal.length])), "");
  for (const w of walks) {
    report.push(`### ${label} port ${w.port}: selected target witnesses`, "", table(["Target", "Reached", "Ordered chain"], [LOUVER, DH, FC, 14106988, 14577396, 14577394, 14607308].map(id => [id, has(w, id), has(w, id) ? chain(w.witnesses.get(id)!) : "not reached"])), "",
      `### ${label} port ${w.port}: every open connector`, "", table(["Connector", "Point ft", "Inferred destination", "Ordered chain"], w.opens.map(o => [`${o.id}:${o.connector}`, JSON.stringify(o.point), o.chosen ? `${o.chosen.toElement}:${o.chosen.toConnector}` : "none", chain(o.path)])), "",
      `<details><summary>${label} port ${w.port}: all ${w.ends.length} stop/rejoin witnesses</summary>`, "", table(["End kind", "At connector", "Ordered chain"], w.ends.map(e => [e.kind, e.at, chain(e.path)])), "", "</details>", "",
      `<details><summary>${label} port ${w.port}: classification changes and native reference anomalies</summary>`, "", table(["Class-change edge"], w.classChanges.map(s => [s])), "", table(["Nonreciprocal native edge"], w.nonreciprocal.map(s => [s])), "", "</details>", "");
  }
}

report.push("## Candidate-box statistics and inferred joins", "", "Candidate counts exclude the source element and include occupied, mismatched-size, and cross-class ports. Ambiguous means more than one candidate element; opposed ambiguity counts more than one element with an opposed port. Counts below are unique open connectors per fan port, so overlap between fan sides is not deduplicated.", "",
  table(["Port", "Open connector", "Candidate elements", "Candidate connectors", "Opposed elements", "Ambiguous", "Chosen", "Gap in", "Facing dot", "Occupied", "Cross-class"], B.flatMap(w => w.opens.map(o => [w.port, `${o.id}:${o.connector}`, new Set(o.candidates.map(c => c.toElement)).size, o.candidates.length, new Set(o.candidates.filter(c => c.opposes).map(c => c.toElement)).size, new Set(o.candidates.map(c => c.toElement)).size > 1, o.chosen ? `${o.chosen.toElement}:${o.chosen.toConnector}` : "none", o.chosen?.gapIn, o.chosen?.facingDot, o.chosen?.occupied, o.chosen?.crossClass]))), "",
  `Ambiguous open-end searches: ${B.flatMap(w => w.opens).filter(o => new Set(o.candidates.map(c => c.toElement)).size > 1).length} of ${B.reduce((n, w) => n + w.opens.length, 0)}.`, "",
  "```json", JSON.stringify(B.map(w => ({ port: w.port, inferredJoins: w.joins })), null, 2), "```", "");
for (const w of B) report.push(`<details><summary>B port ${w.port}: every candidate, in selection order</summary>`, "",
  table(["From", "To", "Kind / family / type", "Gap in", "Facing dot", "Opposes", "Occupied", "Cross-class"], w.opens.flatMap(o => o.candidates.map(c => [`${c.fromElement}:${c.fromConnector}`, `${c.toElement}:${c.toConnector}`, `${get(c.toElement).kind} / ${name(get(c.toElement))}`, c.gapIn, c.facingDot, c.opposes, c.occupied, c.crossClass]))), "", "</details>", "");

const pinned = [LOUVER, 14106988, 14577396, 14577394, MUAS, 14607308, 14122436, DH, 13760866, FC];
report.push("## Expected-chain pin", "", table(["Expected element", "A intake", "A discharge", "B intake", "B discharge", "Interpretation"], pinned.map(id => [id === 13760866 ? `${id} FR-1 (FC-23 branch)` : `${id} ${name(get(id))}`, ...[...A, ...B].map(w => id === MUAS || has(w, id) ? "recovered" : "missed"),
  id === LOUVER ? "A intake witness needs multiport ERV traversal. A discharge stops at 14122436:1; B bridges an occupied plenum connector."
    : id === 14106988 ? "Actual plenum is north of the approximate requested point; capped entry already has connectedTo."
    : id === 14122436 ? "10-inch open port 1. Native gap to plenum/cap connector is 2.628 in, not 1.63 in."
    : id === FC ? "Reached port is a stop, with no fan pressure credited."
    : id === DH ? "Pass-through permitted as requested; internal loss remains unknown."
    : "Present in raw snapshot. Misses reflect branch reachability/open-end stop, not absent elements."])), "",
  "The discharge witness starts MUAS → duct 14605353 → elbow 14606857 → duct 14606754 → elbow 14606764 → duct 14606746 → damper 14607308. Thus the critique's damper-before-elbows wording is not the literal snapshot order.",
  "The Greenheck terminal has a real connector and native link to transition 14107098, which links to plenum 14106988. Its connector is 3.8019 ft from the discharge open end, outside 36 inches; B first acquires the plenum and then reaches the louver natively. The snapshot does not establish that this particular louver lies inside the plenum body.",
  `FR-1 is not unique: ${elements.filter(e => mark(e) === "FR-1").length} elements carry that mark. Element 13760866 is the filter in the FC-23 witness. System labels FA 12 and RA 37 are searchable metadata only, never graph units.`, "",
  table(["Walk", "Port", "FA 12 element ids reached", "RA 37 element ids reached"], [...A, ...B].map(w => [w.infer ? "B" : "A", w.port, [...w.witnesses.keys()].filter(id => get(id).systemName?.split(",").map(s => s.trim()).includes("FA 12")).join(", "), [...w.witnesses.keys()].filter(id => get(id).systemName?.split(",").map(s => s.trim()).includes("RA 37")).join(", ")])), "",
  "## Sensitivity: reachable does not mean an air path", "", table(["Policy", "Port", "Louver", "DH-20", "FC-23", "Ambiguous equipment stops"], [...noMultiport.map(w => ["A; stop at >2-port equipment", w.port, has(w, LOUVER), has(w, DH), has(w, FC), w.multiport.join(", ")]), ...strictB.map(w => ["B; infer only vacant opposed same-class ports", w.port, has(w, LOUVER), has(w, DH), has(w, FC), "all-to-all equipment unchanged"])]), "",
  "The permissive candidate rule can bypass a cap by attaching to its occupied duct port. Native input then routes to the louver, but that says nothing about an actual opening through the cap. A connector-only search must expose occupancy, size, air-stream pairing and cap obstruction rather than treating nearest as valid.", "",
  "## Pricing at ASSUMED 150 cfm on every leg", "",
  "These are arithmetic subtotals, not required ESP. No terminal, heater, silencer, filter, dehumidifier or other equipment drop is invented. No 0.15 in-wg allowance is included. Full duct element lengths are charged, even on a branch-to-branch traversal. Fitting rules come only from loss-rules.ts, interpolation from loss-grid.ts, and friction from loss-physics.ts. Missing retained grids (including CD3-12 and CD9-1) remain unpriced. A resolved round elbow rule uses its 90-degree table even for a smaller measured angle; that assumption is on the row. Collecting taps are unpriced because the retained tap rule is diverging. All 150-cfm leg/branch assumptions are explicitly unbalanced at junctions.",
  "For each walk the intake subtotal uses the first louver witness. A discharge uses its open-end witness; B discharge uses its first louver witness across the occupied connector. The fan is excluded. These are different endpoints and are not comparable certified fan totals. A and B each have the requested pair of sums.", "");
const sums: unknown[][] = [];
const implausible: unknown[][] = [];
for (const w of [...A, ...B]) {
  const path = w.witnesses.get(LOUVER) ?? w.opens.find(o => o.id === 14122436)?.path;
  if (!path) { sums.push([w.infer ? "B" : "A", w.port, "no selected path"]); continue; }
  const priced = price(path, w.port === 1);
  for (const p of priced.filter(p => p.loss != null && p.loss > 1))
    implausible.push([w.infer ? "B" : "A", w.port, p.id, p.loss, p.rule, p.reason]);
  const duct = priced.filter(p => ["duct", "flex"].includes(p.kind)).reduce((n, p) => n + (p.loss ?? 0), 0);
  const fitting = priced.filter(p => !["duct", "flex"].includes(p.kind)).reduce((n, p) => n + (p.loss ?? 0), 0);
  // Independent duct-section check: aggregate lengths by cross-section, then use a separate Darcy calculation.
  const sections = new Map<string, { area: number; diameter: number; length: number }>();
  for (const v of path) {
    const e = get(v.id); if (!["duct", "flex"].includes(e.kind)) continue;
    const s = section(connector(e.id, (w.port === 1 ? v.exit : v.entry) ?? v.entry ?? v.exit ?? -1)) ?? section(e);
    if (!s || e.lengthFt == null) continue;
    const k = `${s.areaFt2}:${s.dhIn}`, old = sections.get(k);
    sections.set(k, { area: s.areaFt2, diameter: s.dhIn, length: (old?.length ?? 0) + e.lengthFt });
  }
  const independent = [...sections.values()].reduce((n, s) => {
    const velocity = Q / s.area, re = 8.56 * s.diameter * velocity;
    const f0 = 0.11 * (12 * 0.0003 / s.diameter + 68 / re) ** 0.25;
    return n + 12 * (f0 >= 0.018 ? f0 : 0.85 * f0 + 0.0028) * s.length / s.diameter * 0.075 * (velocity / 1097) ** 2;
  }, 0);
  assert(Math.abs(independent - duct) < 1e-10, "section-aggregated friction disagrees with leg sum");
  sums.push([w.infer ? "B" : "A", w.port, path.at(-1)!.id, duct, fitting, duct + fitting, priced.filter(p => p.loss == null).length, independent]);
  report.push(`### ${w.infer ? "B" : "A"} ${w.port === 1 ? "intake" : "discharge"} per-leg pricing`, "", table(["Id", "Kind", "Family/type", "Length ft", "Size", "Velocity fpm", "Loss in-wg", "Rule", "Limit / inputs"], priced.map(p => [p.id, p.kind, p.familyType, p.lengthFt, p.size, p.velocity, p.loss, p.rule, p.reason])), "");
  console.log(`${w.infer ? "B" : "A"} port ${w.port}`, JSON.stringify(priced));
}
report.push("### Sums", "", table(["Walk", "Port", "End element", "Duct subtotal in-wg", "Fitting subtotal in-wg", "Known subtotal in-wg", "Unpriced legs", "Independent section duct sum"], sums), "",
  "Unpriced is not zero. Path repetition, multiport assumptions, unknown drops, inferred joins and unbalanced flow block a certified number.", "",
  "### Implausible fitting results", "", table(["Walk", "Port", "Element", "Loss in-wg", "Rule", "Inputs"], implausible), "",
  "The >1 in-wg flag is a spike diagnostic, not a firm threshold. The intake takeoff 14121898 has Ab/Ac=0.0314 and assumed Qb/Qc=1. Bilinear interpolation gives C=802.430533 and 29.186243 in-wg. That dominates the 29.687504 in-wg intake arithmetic subtotal and blocks its use. The per-leg sum is reproducible, but the flow assumption and fitting representation are not a credible design calculation. The native discharge subtotal to its open end is 0.006478 in-wg with four unpriced legs.", "",
  "### Retained grid provenance", "", ...tableSources.map(s => `- ${s}`), "",
  "## Checks and limits", "", "Assertions passed: distinct element/connector identities; finite points; named marks; ascending parsed grid axes and known table cells; exact discharge stop; 2.628-inch gap; permissive plenum selection and louver reach; no-multiport louver failure with DH-20/FC-23 survival; vacant-port discharge louver failure; independent duct-section sums. Input remains read-only. No Revit, pe-revit, browser, package install, or pnpm verify was run.", "",
  "PROVEN[deterministic, this report and pinned raw snapshot, " + commit + ", " + when + "]: candidate acquisition contains the plenum and can obtain the louver through native links. FALSIFIED[deterministic, nearest-facing selection alone proves the plenum-cap join]. UNPROVEN[engineering topology and complete pressure losses].", "");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, report.join("\n"));
console.log(JSON.stringify({ report: output, bytes: bytes.length, sha, timing: { readMs, parseMs, indexMs, A: A.map(w => w.ms), B: B.map(w => w.ms) }, sums, checks: "passed" }, null, 2));

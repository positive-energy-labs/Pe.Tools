import { createHash } from "node:crypto";
import {
  canonicalRouteInput,
  stagedDucts,
  DUCTS_BODY_VERSION_HEADER,
  ductsDocumentSchema,
  type DuctsInputs,
  type WorkKey,
  type WorkAuthor,
  refusalText,
  ductsRosterResponseSchema,
  ductsSheetResponseSchema,
  type DocumentRef,
  type DuctsRosterRequest,
  type DuctsSheetRequest,
  type DuctsSheetOverview,
  type DuctsSheetResponse,
} from "@pe/agent-contracts";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import type { RouteWorkspace } from "@pe/runtime";
import { slotCoverage } from "@pe/ducts-domain/kernel/terminal-flow";
import { contextFetch } from "@pe/runtime/context";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { LOSS_RULES } from "@pe/ducts-domain/loss-rules";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import {
  buildSheet,
  buildChain,
  resolveCriteria,
  resolveInputs,
  scopeInputs,
} from "@pe/ducts-domain/sheet/index";
import { readDuctCatalogs } from "./duct-catalogs.ts";
import { editPatches, readFirm, workLayer } from "./ducts-inputs.ts";
import type { Sheet, Chain, SheetPath } from "@pe/ducts-domain/sheet/types";
import { worksheet } from "@pe/ducts-domain/sheet/worksheet";
import { beyondOf, stoppingUnits, type BeyondUnit } from "@pe/ducts-domain/sheet/beyond";
/** Hops a beyond read walks from a stopping unit: enough for its stubs' 15 ft, never its whole network. */
const BEYOND_HOPS = 12;
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { BridgeError } from "./bridge.ts";

/** The tolerances C# measures model health under (one home, ducts LEDGER 2026-10-29): the project's criteria. */
type Tolerances = { autoJoinGapIn: number; candidateBoxIn: number };
type SnapshotRequest = {
  /** Work's parameter slots (the airflow slot among them): the C# read measures under these. */
  slots?: Partial<Record<string, string>>;
  selector:
    | { kind: "document" }
    | { kind: "roster" }
    | ({ kind: "from"; unitId: number; portIndex?: number; maxHops?: number } & Tolerances);
};
// Each rule's default, the fallback it prices when that default is not served (ER5-2 for ER5-1),
// and every option a person may pick: a picked table prices only if its grid is served, and the
// picker names each option by the ASHRAE title its grid carries (a missing id is reported, not thrown).
const tableRequest = {
  ids: [
    ...new Set(
      LOSS_RULES.flatMap((rule) => [
        rule.table,
        ...rule.options,
        ...(rule.fallback ? [rule.fallback] : []),
      ]),
    ),
  ].sort(),
};
/** Each served table's ASHRAE title (its first result grid's), by table id. */
const titlesOf = (grids: ReturnType<typeof toGrids>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(grids).flatMap(([id, results]) => {
      const title = Object.values(results)[0]?.title;
      return title ? [[id, title]] : [];
    }),
  );
/** Union two `from` reads of one document by element id (a walked copy wins over a candidate copy), and their health by id. */
function mergeSnapshots(a: DuctSnapshot, b: DuctSnapshot): DuctSnapshot {
  const union = <T extends { id: number; reason?: string | null }>(
    x: readonly T[],
    y: readonly T[],
  ) => {
    const byId = new Map(x.map((e) => [e.id, e]));
    for (const e of y) {
      const have = byId.get(e.id);
      if (!have || ((have.reason ?? "walked") !== "walked" && (e.reason ?? "walked") === "walked"))
        byId.set(e.id, e);
    }
    return [...byId.values()];
  };
  return {
    ...a,
    nodes: union(a.nodes as never[], b.nodes as never[]) as DuctSnapshot["nodes"],
    segments: union(a.segments as never[], b.segments as never[]) as DuctSnapshot["segments"],
    // Health is model truth, measured the same way in either read; the first copy of an id stands.
    issues: [...new Map([...b.issues, ...a.issues].map((i) => [i.id, i])).values()],
  };
}
export interface DuctsSheetSources {
  call: (
    key: "ducts.snapshot" | "ducts.tables",
    request: SnapshotRequest | { ids: string[] },
    target: DocumentRef,
    version?: string,
  ) => Promise<Response>;
}

/** Use /call admission and its raw reading owner, including on a retained detail hit. */
export const sheetNativeRead =
  (base: string): DuctsSheetSources["call"] =>
  (key, request, target, version) =>
    createPeClient(base, contextFetch).response(
      "operation.call",
      {
        body: { key, request },
      },
      {
        headers: {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
          [HOST_RPC_DOCUMENT_HEADER]: target.openId,
          ...(version ? { [DUCTS_BODY_VERSION_HEADER]: version } : {}),
        },
      },
    );

const stale = () =>
  new BridgeError("Stale sheet basis; read a new overview before using detail handles", 409, {
    notDispatched: true,
  });
const subjectKey = ({
  detail: _detail,
  basis: _basis,
  proposal: _proposal,
  edits: _edits,
  ...subject
}: DuctsSheetRequest) => canonicalRouteInput(subject);
type Entry = {
  /** Target, mode, fan or chain, and the layers' state (Work revision, firm version): what one sheet is a sheet of. */
  subject: string;
  /** Everything the engine priced from, resolved (ducts LEDGER 2026-10-29). */
  inputs: DuctsInputs;
  firm: { version: string; path: string; present: boolean };
  layers: string;
  request: SnapshotRequest;
  version: string;
  tablesVersion: string;
  target: DocumentRef;
  value: Sheet | Chain;
  mode: "fan" | "chain";
  /** The ASHRAE title of every served table, by id: what each table option means. */
  titles: Record<string, string>;
  /** Context only: the networks past each unit this fan stops at; never priced (`beyond.ts`). */
  beyond: BeyondUnit[];
};

/** Resolved kinds and roles by unit id, so the roster reads the same rulings the engine prices under. */
const rosterInputs = (inputs: DuctsInputs) => ({
  kinds: Object.fromEntries(Object.entries(inputs.units).map(([id, u]) => [id, u.kind.value])),
  roles: Object.fromEntries(Object.entries(inputs.units).map(([id, u]) => [id, u.role.value])),
});
const pathsOf = (value: Sheet | Chain): SheetPath[] =>
  "paths" in value ? value.paths : value.path ? [value.path] : [];
const compact = (value: Sheet["blockers"][number]) => ({
  id: value.id,
  kind: value.kind,
  elementId: value.elementId,
  ...(value.connector === undefined ? {} : { connector: value.connector }),
  effectInWg: value.effectInWg,
  closer: value.closer.kind,
  ...(value.proposal ? { proposal: value.proposal } : {}),
  ...(value.owner ? { owner: value.owner } : {}),
  ...(value.causedBy ? { causedBy: value.causedBy } : {}),
});
/** Known blockers first, then the assumed pass's own (R-B consequences cite a known id). */
/** Known first: a blocker the known pass raises is never a consequence of an assumed heal (R-B). */
const allBlockers = (value: Sheet | Chain) => {
  const known = new Map(value.blockers.map((b) => [b.id, b]));
  const assumed = "assumed" in value ? value.assumed.blockers.filter((b) => !known.has(b.id)) : [];
  return [...known.values(), ...assumed];
};

/**
 * The elements one sheet reaches: what it walked (both passes), its fan, and what its blockers
 * stand on (their own element, the candidate or proposal they name). The inputs detail is scoped to
 * these, so every element row it returns is one the page's element snapshot names (UI5).
 */
export function sheetReach(value: Sheet | Chain): Set<number> {
  return new Set([
    ...value.walkedElementIds,
    ...("fan" in value ? [value.fan.unitId] : [value.start.elementId]),
    ...allBlockers(value).flatMap((b) =>
      [b.elementId, b.closer.candidate?.toElementId, b.proposal?.to.elementId].filter(
        (id): id is number => id != null,
      ),
    ),
  ]);
}

function overview(entry: Entry): DuctsSheetOverview {
  const paths = pathsOf(entry.value);
  const side = (name: "supply" | "return") => {
    const ranked = paths
      .map((path, index) => ({ path, index }))
      .filter(({ path }) => path.side === name);
    return {
      paths: ranked.slice(0, 5).map(({ path, index }) => ({
        pathId: String(index),
        end: path.end,
        knownInWg: path.knownInWg,
        complete: path.complete,
        legCount: path.legIds.length,
        blockerIds: path.blockerIds,
      })),
      rest: Math.max(0, ranked.length - 5),
    };
  };
  const supply = side("supply"),
    ret = side("return");
  return {
    kind: "overview",
    mode: entry.mode,
    target: entry.target,
    basis: entry.value.basis,
    fan: "fan" in entry.value ? entry.value.fan : null,
    totals: "totals" in entry.value ? entry.value.totals : null,
    paths: { supply, return: ret },
    blockers: entry.value.blockers.map(compact),
    assumedBlockers: "assumed" in entry.value ? entry.value.assumed.blockers.map(compact) : [],
    next: {
      hint: "Repeat this request with basis and detail. legs needs pathId; elements returns walkedElementIds and, as context only (never priced), a short stub from every port of each unit this fan stops at; inputs returns provenance and full blocker closers; worksheet returns every run and section with its legs. Other paths use their zero-based engine path index.",
      legs: [...supply.paths, ...ret.paths].map(({ pathId }) => ({ kind: "legs", pathId })),
      elements: { kind: "elements" },
      inputs: { kind: "inputs" },
      worksheet: { kind: "worksheet" },
    },
  };
}
interface SheetWork {
  workspace: RouteWorkspace;
  key(target: DocumentRef): Promise<WorkKey>;
  author(): WorkAuthor;
}
export function createDuctsSheets(sources: DuctsSheetSources, work?: SheetWork) {
  /** The layers the resolver reads: Work's staged edits and the firm file, with the state that names them. */
  async function loadLayers(target: DocumentRef) {
    const scope = work ? await work.key(target) : null;
    const owned = scope && work ? await work.workspace.readRaw(scope, "ducts") : null;
    const doc = owned ? ductsDocumentSchema.parse(owned.doc) : null;
    const firm = await readFirm();
    return {
      scope,
      revision: owned?.revision ?? 0,
      doc,
      work: workLayer(doc),
      firm,
      /** Any Work change or firm change renames the layers, so every cached sheet over them goes stale. */
      layers: `${owned?.revision ?? 0}:${firm.firm.version}`,
    };
  }
  type Layers = Awaited<ReturnType<typeof loadLayers>>;
  async function applyEdits(request: DuctsSheetRequest, saved: Layers): Promise<Layers> {
    if (!request.edits) return saved;
    if (!work || !saved.scope)
      throw new BridgeError("Document Work is unavailable for sheet edits", 409, {
        notDispatched: true,
      });
    const result = await work.workspace.apply(
      saved.scope,
      "ducts",
      work.author(),
      editPatches(request.edits, saved.doc),
      saved.revision,
    );
    if (!result.ok) throw new BridgeError(refusalText(result), 409, { notDispatched: true });
    return loadLayers(request.target);
  }
  const firmOf = (saved: Layers) => ({
    version: saved.firm.firm.version,
    path: saved.firm.path,
    present: saved.firm.present,
  });
  const subjectOf = (request: DuctsSheetRequest, saved: Layers) =>
    canonicalRouteInput([subjectKey(request), saved.layers]);
  const tolerancesOf = (criteria: DuctsInputs["criteria"]): Tolerances => ({
    autoJoinGapIn: criteria.autoJoinGapIn.value,
    candidateBoxIn: criteria.healBoxIn.value,
  });
  // Results are disposable. The raw owner separately bounds acquisition bytes and invalidates versions.
  const entries = new Map<string, Entry>();
  async function readNative(
    key: "ducts.snapshot" | "ducts.tables",
    request: SnapshotRequest | { ids: string[] },
    target: DocumentRef,
    version?: string,
  ) {
    const response = await sources.call(key, request, target, version);
    if (!response.ok)
      throw new BridgeError(await response.text(), response.status, { notDispatched: true });
    return response;
  }
  /**
   * The C# `from` walk follows Revit connectors only, so it stops where an accepted join bridges a gap:
   * the far side arrives as an open-end candidate and its own connections read as open ends that are
   * not open in Revit (MUAS-1's FA 43 onto the louver plenum, 2026-10-28). Walk again from the far
   * element of every accepted pair whose near side was walked, merge, and repeat until no accepted
   * join points outside the read. Elements are unioned by id; a walked copy wins over a candidate.
   * ponytail: one extra `from` read per bridged join and round (bounded at four rounds); fold the
   * seeds into one native read if this gets slow.
   */
  async function followAcceptedJoins(
    snapshot: DuctSnapshot,
    rulings: readonly { pair: readonly string[]; verdict: string }[],
    target: DocumentRef,
    tolerances: Tolerances,
    slots: SnapshotRequest["slots"],
  ): Promise<DuctSnapshot> {
    type Walked = { id: number; reason?: string | null };
    const elementOf = (end: string) => Number(end.split(":")[0]);
    const seeded = new Set<number>();
    let merged = snapshot;
    for (let round = 0; round < 4; round += 1) {
      const walked = new Set(
        [...merged.nodes, ...merged.segments]
          .filter((e) => ((e as Walked).reason ?? "walked") === "walked")
          .map((e) => e.id),
      );
      const seeds = rulings
        .filter((r) => r.verdict === "accept")
        .flatMap((r) => {
          const [a, b] = r.pair.map(elementOf) as [number, number];
          return walked.has(a) && !walked.has(b) ? [b] : walked.has(b) && !walked.has(a) ? [a] : [];
        })
        .filter((id) => !seeded.has(id));
      if (seeds.length === 0) break;
      for (const id of seeds) {
        seeded.add(id);
        const more = (await (
          await readNative(
            "ducts.snapshot",
            { ...(slots ? { slots } : {}), selector: { kind: "from", unitId: id, ...tolerances } },
            target,
          )
        ).json()) as DuctSnapshot;
        merged = mergeSnapshots(merged, more);
      }
    }
    return merged;
  }
  /**
   * What lies past each unit this fan's walk stops at (kaitpw 2026-10-30, "yes show"): one short
   * `from` read per stopping unit (BEYOND_HOPS), merged over this sheet's read, then a stub from
   * each of its ports (`beyondOf`). Context
   * only: it is read after the sheet is built and feeds nothing the engine prices. Reads are cached
   * by the document, the layers and the sheet read's observation version (a model change or any
   * Work or firm change reads again); the reading owner also retains each body.
   */
  const beyondReads = new Map<string, DuctSnapshot>();
  async function readBeyond(
    sheet: Sheet,
    snapshot: DuctSnapshot,
    target: DocumentRef,
    cacheKey: string,
    tolerances: Tolerances,
    slots: SnapshotRequest["slots"],
    markOf: (unitId: number) => string,
  ): Promise<BeyondUnit[]> {
    let merged = snapshot;
    for (const { unitId } of stoppingUnits(sheet)) {
      const key = `${cacheKey}|${unitId}`;
      let read = beyondReads.get(key);
      if (!read) {
        read = (await (
          await readNative(
            "ducts.snapshot",
            {
              ...(slots ? { slots } : {}),
              selector: { kind: "from", unitId, maxHops: BEYOND_HOPS, ...tolerances },
            },
            target,
          )
        ).json()) as DuctSnapshot;
        beyondReads.set(key, read);
        while (beyondReads.size > 64) beyondReads.delete(beyondReads.keys().next().value!);
      }
      merged = mergeSnapshots(merged, read);
    }
    return beyondOf(merged, sheet, markOf);
  }
  async function current(entry: Entry) {
    const responses = await Promise.all([
      readNative("ducts.snapshot", entry.request, entry.target, entry.version),
      readNative("ducts.tables", tableRequest, entry.target, entry.tablesVersion),
    ]);
    await Promise.all(responses.map((response) => response.body?.cancel()));
  }
  return {
    async sheet(request: DuctsSheetRequest): Promise<DuctsSheetResponse> {
      let saved = await loadLayers(request.target);
      if (request.proposal) {
        const entry = request.basis ? entries.get(request.basis) : undefined;
        // The entry must be this fan's sheet over the layers as saved now.
        if (!entry || request.detail || entry.subject !== subjectOf(request, saved)) throw stale();
        await current(entry);
        const all = allBlockers(entry.value);
        const choice = request.proposal;
        // A person may accept the same-class proposal or the class crossing the row offers beside it.
        const offered = (b: (typeof all)[number]) =>
          [b.proposal?.pair, b.closer.crossing?.pair].some(
            (pair) => pair?.every((p) => choice.pair.includes(p)) ?? false,
          );
        if (!all.some(offered))
          throw new BridgeError("Proposal is not on this sheet basis", 409, {
            notDispatched: true,
          });
        // A proposal verdict is a join ruling: one Work edit, like any other input.
        request = {
          ...request,
          edits: { ...request.edits, joins: [...(request.edits?.joins ?? []), choice] },
        };
      }
      saved = await applyEdits(request, saved);
      const subject = subjectOf(request, saved);
      if (request.detail) {
        const entry = request.basis ? entries.get(request.basis) : undefined;
        if (!entry || entry.subject !== subject) throw stale();
        await current(entry);
        const base = { target: entry.target, basis: entry.value.basis };
        if (request.detail.kind === "elements")
          return {
            ...base,
            kind: "elements",
            walkedElementIds: entry.value.walkedElementIds,
            beyond: entry.beyond,
          };
        if (request.detail.kind === "worksheet") {
          if (!("assumed" in entry.value))
            throw new BridgeError("A worksheet is a fan sheet's; a chain has one path", 400, {
              notDispatched: true,
            });
          const limit = entry.inputs.criteria.velocityLimitFpm;
          const limits = { supply: limit.supply.value, return: limit.return.value };
          const sheet = entry.value;
          const w = worksheet(sheet, { maxFpm: limits });
          const named = new Set([...w.supply.runs, ...w.return.runs].flatMap((r) => r.legIds));
          return ductsSheetResponseSchema.parse({
            ...base,
            kind: "worksheet",
            limits: {
              supplyFpm: limits.supply,
              returnFpm: limits.return,
              source: `${limit.supply.source}${limit.supply.ref ? `:${limit.supply.ref}` : ""}`,
            },
            supply: w.supply,
            return: w.return,
            legs: Object.fromEntries([...named].map((id) => [id, sheet.legs[id]])),
          });
        }
        if (request.detail.kind === "inputs")
          return {
            ...base,
            kind: "inputs",
            inputs: scopeInputs(entry.inputs, sheetReach(entry.value)),
            firm: entry.firm,
            ends: [
              ...new Map(
                [
                  ...pathsOf(entry.value),
                  ...("assumed" in entry.value ? entry.value.assumed.paths : []),
                ].map((p) => [canonicalRouteInput(p.end), p.end]),
              ).values(),
            ],
            fittings: entry.value.fittings,
            tableTitles: entry.titles,
            notes: entry.value.notes,
            blockers: allBlockers(entry.value),
          };
        const path = pathsOf(entry.value)[Number(request.detail.pathId)];
        if (!/^(0|[1-9][0-9]*)$/.test(request.detail.pathId) || !path)
          throw new BridgeError("Unknown sheet path handle", 404, { notDispatched: true });
        return ductsSheetResponseSchema.parse({
          ...base,
          kind: "legs",
          pathId: request.detail.pathId,
          legs: path.legIds.map((id) => entry.value.legs[id]),
        });
      }
      // A fan sheet walks both sides, so acquire from every port of the unit; the engine picks this fan's ports.
      // ponytail: an ERV acquires its second fan's sides too; filter by the roster's port pairing if reads get heavy.
      // The project's criteria are the read tolerances: C# measures health under them (one home).
      const criteria = resolveCriteria(saved.work, null, saved.firm.firm);
      const tolerances = tolerancesOf(criteria);
      // The Protocol slot is a Work `parameters` cell: without it the read measured terminal flow
      // under the document's stored slot, so switching the sheet's airflow slot repriced nothing.
      const staged = stagedDucts(saved.doc).parameters;
      const slots = Object.keys(staged).length ? staged : undefined;
      const acquisition: SnapshotRequest = {
        ...(slots ? { slots } : {}),
        selector:
          request.mode === "fan"
            ? { kind: "from", unitId: request.unitId, ...tolerances }
            : {
                kind: "from",
                unitId: request.start.elementId,
                ...(request.start.connector === undefined
                  ? {}
                  : { portIndex: request.start.connector }),
                ...tolerances,
              },
      };
      const [response, tables] = await Promise.all([
        readNative("ducts.snapshot", acquisition, request.target),
        readNative("ducts.tables", tableRequest, request.target),
      ]);
      const version = response.headers.get(DUCTS_BODY_VERSION_HEADER);
      const tablesVersion = tables.headers.get(DUCTS_BODY_VERSION_HEADER);
      if (!version || !tablesVersion)
        throw new BridgeError("Ducts read did not return an observation version", 409, {
          notDispatched: true,
        });
      const catalogs = (await readDuctCatalogs()).tables;
      const first = (await response.json()) as DuctSnapshot;
      const layersOf = (snap: DuctSnapshot) => ({
        snapshot: snap,
        work: saved.work,
        store: snap.store as Parameters<typeof resolveInputs>[0]["store"],
        firm: saved.firm.firm,
        catalogs,
      });
      const snapshot = await followAcceptedJoins(
        first,
        resolveInputs(layersOf(first)).rulings.joins,
        request.target,
        tolerances,
        slots,
      );
      const inputs = resolveInputs(layersOf(snapshot));
      const grids = toGrids(await tables.json());
      const roster = suggestRoster(snapshot, [], rosterInputs(inputs));
      const ports = [...roster.fans, ...roster.suggestions];
      const value =
        request.mode === "fan"
          ? buildSheet({
              snapshot,
              grids,
              inputs,
              roster: ports,
              fan: { unitId: request.unitId, portIndex: request.portIndex },
            })
          : buildChain({
              snapshot,
              grids,
              inputs,
              roster: ports,
              start: request.start,
              end: request.end,
              direction: request.direction,
              ...(inputs.terminals[String(request.end.elementId)]?.cfm.value != null
                ? { flowCfm: inputs.terminals[String(request.end.elementId)]!.cfm.value! }
                : {}),
            });
      const beyond =
        request.mode === "fan"
          ? await readBeyond(
              value as Sheet,
              snapshot,
              request.target,
              JSON.stringify([request.target, saved.layers, version]),
              tolerances,
              slots,
              (unitId) => ports.find((p) => p.unitId === unitId)?.tag ?? `unit ${unitId}`,
            )
          : [];
      // The engine hashes its inputs; the host also binds the native observation and exact request.
      value.basis = createHash("sha256")
        .update(JSON.stringify([request.target, version, tablesVersion, subject, value.basis]))
        .digest("hex");
      const entry: Entry = {
        subject,
        inputs,
        firm: firmOf(saved),
        layers: saved.layers,
        request: acquisition,
        version,
        tablesVersion,
        target: request.target,
        mode: request.mode,
        value,
        titles: titlesOf(grids),
        beyond,
      };
      await current(entry);
      for (const [basis, previous] of entries)
        if (previous.subject === subject) entries.delete(basis);
      while (entries.size >= 16) entries.delete(entries.keys().next().value!);
      entries.set(value.basis, entry);
      return ductsSheetResponseSchema.parse(overview(entry));
    },
    async roster(request: DuctsRosterRequest) {
      // Units and terminals only: the whole-document read exceeded the 16 MiB bridge frame on Chadds (2026-10-28).
      // Work's protocol slots ride along as on the sheet's own read: a unit's fanFlow fact (its design
      // flow, and whether the roster proposes it a fan) is read under the person's fan-flow slot.
      const saved = await loadLayers(request.target);
      const staged = stagedDucts(saved.doc).parameters;
      const acquisition: SnapshotRequest = {
        ...(Object.keys(staged).length ? { slots: staged } : {}),
        selector: { kind: "roster" },
      };
      const response = await readNative("ducts.snapshot", acquisition, request.target);
      const snapshot = (await response.json()) as DuctSnapshot;
      const inputs = resolveInputs({
        snapshot,
        work: saved.work,
        store: snapshot.store as Parameters<typeof resolveInputs>[0]["store"],
        firm: saved.firm.firm,
      });
      const roster = suggestRoster(snapshot, [], rosterInputs(inputs));
      const activeSlot = staged.terminalFlow ?? snapshot.slots?.terminalFlow ?? "terminalFlow";
      const rows = [];
      for (const port of [...roster.fans, ...roster.suggestions]) {
        const cached = [...entries.values()]
          .reverse()
          .find(
            (entry) =>
              entry.mode === "fan" &&
              entry.target.session === request.target.session &&
              entry.target.openId === request.target.openId &&
              "fan" in entry.value &&
              entry.value.fan.unitId === port.unitId &&
              entry.value.fan.portIndex === port.portIndex,
          );
        let sheet: Sheet | undefined;
        if (cached) {
          try {
            await current(cached);
            const candidate = cached.value as Sheet;
            if (saved.layers === cached.layers) sheet = candidate;
          } catch (error) {
            if (!(error instanceof BridgeError) || error.statusCode !== 409) throw error;
            entries.delete(cached.value.basis);
          }
        }
        // R3 (kaitpw 2026-10-28): `externalStatic` is the firm's one ESP parameter
        // (PE_M_Fan_ExternalStaticPressure), the REQUIRED ESP Pe writes; the page labels it
        // "required (written)". Rated ESP has no firm slot yet; the contract field keeps its name.
        const rating = inputs.units[String(port.unitId)]?.esp.value ?? null;
        rows.push({
          unitId: port.unitId,
          portIndex: port.portIndex,
          mark: port.tag,
          kind: port.kind,
          side: port.side,
          ratedEspInWg: sheet?.fan.ratedEspInWg ?? rating,
          confirmed: roster.fans.includes(port),
          ...(sheet
            ? {
                blockerCount: sheet.blockers.length,
                requiredEspInWg: sheet.totals.requiredEspInWg,
                requiredEspAssumedInWg: sheet.totals.requiredEspAssumedInWg,
                complete: sheet.totals.supply.complete && sheet.totals.return.complete,
              }
            : {}),
        });
      }
      return ductsRosterResponseSchema.parse({
        target: request.target,
        rows,
        // The active slot is listed even when no terminal holds it (a route default such as "Actual Supply Air Flow" read 0/0 unlisted on Chadds).
        slots: slotCoverage(snapshot.nodes, [activeSlot, snapshot.slots?.terminalFlow]),
        activeSlot,
      });
    },
  };
}

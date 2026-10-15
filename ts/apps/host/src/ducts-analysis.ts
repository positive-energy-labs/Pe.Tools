import { createPeClient } from "@pe/agent-contracts/pe-api";
import { contextFetch } from "@pe/runtime/context";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addressSchema,
  bindWork,
  ductsDocumentSchema,
  stagedDucts,
  type DocumentRef,
  type DuctsRouteDocument,
  type WorkKey,
  type DuctsAnalysisRequest,
  type DuctsAnalysisResponse,
} from "@pe/agent-contracts";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { price, proposedStatic, TABLE_IDS, unitOf } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import { groupTree, terminalCfm } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { DocumentMarks } from "./document-marks.ts";
import { sha256Hex, writeArtifact } from "./page-artifacts.ts";

type Observation = {
  target: DocumentRef;
  address: string | null;
  title: string;
  process: { pid: number; startUtcUnixMs: number };
  provenance: unknown;
};
export interface DuctsAnalysisSources {
  root: string;
  producer: unknown;
  marks: DocumentMarks;
  resolve: (target: DocumentRef) => Promise<Observation>;
  call: (
    key: "ducts.snapshot" | "ducts.tables",
    request: unknown,
    target: DocumentRef,
  ) => Promise<Response>;
  readWork: (key: WorkKey) => Promise<{ doc: unknown; revision: number } | null>;
}
type EffectiveInputs = { snapshot: DuctSnapshot; tables: unknown; work: DuctsRouteDocument | null };
const solve = ({ snapshot, tables, work }: EffectiveInputs) => {
  const priced = price(snapshot, toGrids(tables), work);
  const equipmentIds = [
    ...new Set([
      ...snapshot.nodes.filter((node) => node.kind === "equipment").map((node) => node.id),
      ...snapshot.groups.flatMap((group) => group.rootIds),
    ]),
  ].sort((a, b) => a - b);
  return {
    now: priced.now,
    next: priced.next,
    readiness: readiness(snapshot, work),
    equipment: equipmentIds.map((id) => ({
      id,
      now: proposedStatic(snapshot, priced.now, id),
      next: proposedStatic(snapshot, priced.next, id),
    })),
  };
};
type Artifact = {
  format: "ducts-analysis-v1";
  createdAt: string;
  producer: unknown;
  observation: Observation;
  work: { kind: "canonical" | "observed-only"; key: WorkKey; revision: number | null };
  freshness: DuctsAnalysisResponse["freshness"];
  input: { encoding: "utf8"; json: string; sha256: string; byteSize: number };
  transportLabel: "host-/call HTTP response JSON; not original native transport bytes";
  acquisition: {
    key: string;
    request: unknown;
    status: number;
    headers: Record<string, string>;
    bodyUtf8: string;
    sha256: string;
    byteSize: number;
  }[];
  outputs: ReturnType<typeof solve>;
};
const MAX_BYTES = 64 * 1024 * 1024;
const space = (node: DuctSnapshot["nodes"][number]) =>
  node.facts.find((f) => f.key === "space")?.text ?? null;
const label = (node: DuctSnapshot["nodes"][number]) =>
  [node.family, node.type].filter(Boolean).join(" / ") || String(node.id);
const terminal = (node: DuctSnapshot["nodes"][number]) => node.kind === "terminal";
const inputOf = (artifact: Artifact): EffectiveInputs => {
  if (
    artifact.format !== "ducts-analysis-v1" ||
    sha256Hex(artifact.input.json) !== artifact.input.sha256 ||
    Buffer.byteLength(artifact.input.json) !== artifact.input.byteSize
  )
    throw Error("Analysis effective-input integrity failed");
  return JSON.parse(artifact.input.json) as EffectiveInputs;
};

/** Native reads retain the invoking context and pass through the existing admission door. */
export const ductsNativeRead =
  (hostBaseUrl: string): DuctsAnalysisSources["call"] =>
  (key, request, target) =>
    createPeClient(hostBaseUrl, contextFetch).response(
      "operation.call",
      { body: { key, request } },
      {
        headers: {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
          [HOST_RPC_DOCUMENT_HEADER]: target.openId,
        },
      },
    );

/** One immutable full-graph result; every later selector projects these same inputs and outputs. */
export function createDuctsAnalysis(sources: DuctsAnalysisSources) {
  const artifactBytes = async (id: string) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid analysis artifact id");
    const bytes = await readFile(join(sources.root, `${id}.json`));
    if (bytes.length > MAX_BYTES || sha256Hex(bytes) !== id)
      throw Error("Analysis artifact integrity failed");
    return bytes;
  };
  async function acquire(target: DocumentRef): Promise<Artifact> {
    const began = Date.now();
    const beforeMark = sources.marks.changedAt(target);
    const observedSince = sources.marks.observedSince;
    const observation = await sources.resolve(target);
    if (JSON.stringify(observation.target) !== JSON.stringify(target))
      throw Error("Analysis resolved a different document lifetime");
    const key = bindWork(
      "ducts",
      observation.address ? addressSchema.parse(observation.address) : null,
      undefined,
      target,
    );
    const owned = await sources.readWork(key);
    const work = owned ? ductsDocumentSchema.parse(owned.doc) : null;
    const acquisition: Artifact["acquisition"] = [];
    async function read(key: "ducts.snapshot" | "ducts.tables", request: unknown) {
      const response = await sources.call(key, request, target);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_BYTES)
        throw Error(`${key} response exceeds the analysis byte budget; graph was not clipped`);
      if (!response.ok)
        throw Object.assign(
          Error(`${key} refused (${response.status}): ${bytes.toString("utf8").slice(0, 2000)}`),
          { statusCode: response.status },
        );
      const bodyUtf8 = bytes.toString("utf8");
      acquisition.push({
        key,
        request,
        status: response.status,
        headers: Object.fromEntries(response.headers),
        bodyUtf8,
        sha256: sha256Hex(bytes),
        byteSize: bytes.length,
      });
      return JSON.parse(bodyUtf8) as unknown;
    }
    const slots = stagedDucts(work).parameters;
    const snapshot = (await read(
      "ducts.snapshot",
      Object.keys(slots).length ? { slots } : {},
    )) as DuctSnapshot;
    const tables = await read("ducts.tables", { ids: [...TABLE_IDS] });
    const inputJson = JSON.stringify({ snapshot, tables, work } satisfies EffectiveInputs);
    if (Buffer.byteLength(inputJson) > MAX_BYTES)
      throw Error("Full analysis inputs exceed the byte budget; graph was not clipped");
    const effective = JSON.parse(inputJson) as EffectiveInputs;
    const outputs = solve(effective);
    const after = await sources.resolve(target);
    const afterWork = await sources.readWork(key);
    const changed =
      JSON.stringify(observation) !== JSON.stringify(after) ||
      beforeMark !== sources.marks.changedAt(target) ||
      observedSince !== sources.marks.observedSince ||
      owned?.revision !== afterWork?.revision ||
      JSON.stringify(owned?.doc) !== JSON.stringify(afterWork?.doc);
    const fresh = observedSince !== undefined && observedSince <= began;
    return {
      format: "ducts-analysis-v1",
      createdAt: new Date().toISOString(),
      producer: sources.producer,
      observation,
      work: { kind: owned ? "canonical" : "observed-only", key, revision: owned?.revision ?? null },
      freshness: {
        state: changed ? "changed" : fresh ? "fresh" : "unknown",
        observedAt: new Date(began).toISOString(),
        reason: changed
          ? "Document, process, Work or observation changed during acquisition"
          : fresh
            ? "No observed change during sequential snapshot/table reads; not an atomic snapshot"
            : "Host did not establish a change-observation boundary",
      },
      transportLabel: "host-/call HTTP response JSON; not original native transport bytes",
      input: {
        encoding: "utf8",
        json: inputJson,
        sha256: sha256Hex(inputJson),
        byteSize: Buffer.byteLength(inputJson),
      },
      acquisition,
      outputs,
    };
  }
  return {
    artifact: async (id: string) =>
      new Response(await artifactBytes(id), {
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    async read(request: DuctsAnalysisRequest): Promise<DuctsAnalysisResponse> {
      let artifact: Artifact, bytes: Buffer, id: string;
      if (request.source.kind === "fresh") {
        artifact = await acquire(request.source.target);
        bytes = Buffer.from(JSON.stringify(artifact));
        if (bytes.length > MAX_BYTES)
          throw Error("Analysis artifact exceeds byte budget; no partial artifact was published");
        id = sha256Hex(bytes);
        await writeArtifact(sources.root, join(sources.root, `${id}.json`), bytes);
      } else {
        id = request.source.id;
        bytes = await artifactBytes(id);
        artifact = JSON.parse(bytes.toString("utf8")) as Artifact;
      }
      return project(artifact, inputOf(artifact), request, id, bytes.length);
    },
  };
}

function project(
  artifact: Artifact,
  input: EffectiveInputs,
  request: DuctsAnalysisRequest,
  id: string,
  byteSize: number,
): DuctsAnalysisResponse {
  const { snapshot, work } = input;
  const { now, next } = artifact.outputs;
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const terminals = snapshot.nodes.filter(terminal);
  const equipmentIds = [
    ...new Set([
      ...snapshot.nodes.filter((node) => node.kind === "equipment").map((node) => node.id),
      ...snapshot.groups.flatMap((group) => group.rootIds),
    ]),
  ].sort((a, b) => a - b);
  const selector = request.selector;
  let groups = snapshot.groups;
  let selectedTerminals = terminals;
  let state: DuctsAnalysisResponse["selection"]["state"] = "matched";
  if (selector.kind === "equipment")
    groups = groups.filter(
      (group) =>
        group.rootIds.includes(selector.id) || unitOf(snapshot, next, group) === selector.id,
    );
  if (selector.kind === "group") groups = groups.filter((group) => group.id === selector.id);
  if (selector.kind === "terminal" || selector.kind === "space-text") {
    selectedTerminals = terminals.filter((node) =>
      selector.kind === "terminal"
        ? node.id === selector.id
        : space(node)?.toLocaleLowerCase("en-US") === selector.text.toLocaleLowerCase("en-US"),
    );
    const groupIds = new Set(selectedTerminals.map((node) => node.groupId));
    groups = groups.filter((group) => groupIds.has(group.id));
    // Text has no stable Space id/phase/link identity in the native snapshot.
    if (selector.kind === "space-text" && selectedTerminals.length) state = "ambiguous";
  }
  const groupIds = new Set(groups.map((group) => group.id));
  if (selector.kind === "equipment" || selector.kind === "group")
    selectedTerminals = selectedTerminals.filter((node) => groupIds.has(node.groupId ?? ""));
  if (
    !groups.length ||
    ((selector.kind === "terminal" || selector.kind === "space-text") && !selectedTerminals.length)
  )
    state = "not-found";
  if (selector.kind === "equipment" && equipmentIds.includes(selector.id)) state = "matched";
  if (selector.kind === "equipment" && groups.some((group) => group.rootIds.length !== 1))
    state = "ambiguous";
  const reasons = new Map<string, { code: string; count: number; message: string }>();
  const reason = (code: string, count: number, message: string) => {
    if (count) reasons.set(code, { code, count, message });
  };
  const issues = new Map(snapshot.issues.map((issue) => [issue.id, issue]));
  reason(
    "selection",
    state === "matched" ? 0 : 1,
    `Selection is ${state}; space text cannot prove a stable room identity`,
  );
  reason(
    "freshness",
    artifact.freshness.state === "fresh" ? 0 : 1,
    artifact.freshness.reason ?? "Observation freshness is unknown",
  );
  let topology = 0,
    blockers = 0;
  for (const group of groups) {
    const tree = groupTree(snapshot, group.id);
    if (tree.rooted !== "port" || tree.extraRoots.length || tree.backEdges.length) topology++;
    const ready = artifact.outputs.readiness[group.id];
    // Fan rating is needed to compare capacity, never to compute required external static.
    blockers +=
      (ready?.walk.length ?? 0) +
      (ready?.budget.filter((key) => issues.get(key)?.kind !== "no-fan-static").length ?? 0);
  }
  reason("topology", topology, "Stand-in roots, multiple roots or loops affect the selected graph");
  reason(
    "unresolved-inputs",
    blockers,
    "Unresolved topology, flow, component-drop or roughness inputs remain",
  );
  const reportedTerminals = groups.reduce((sum, group) => sum + group.terminalCount, 0);
  const fullGroupSelection =
    selector.kind === "document" || selector.kind === "group" || selector.kind === "equipment";
  const expectedTerminals = fullGroupSelection
    ? Math.max(selectedTerminals.length, reportedTerminals)
    : selectedTerminals.length;
  reason(
    "terminal-census-mismatch",
    fullGroupSelection ? Math.abs(reportedTerminals - selectedTerminals.length) : 0,
    "Reported group terminal counts and retained terminal nodes differ; selection coverage is incomplete",
  );
  const reached = selectedTerminals.filter((node) => next.paths[node.id]);
  const dropKnown = (node: DuctSnapshot["nodes"][number]) => {
    const drop = node.terminalDrop;
    // Assigned connector loss has no catalog-source provenance, even under SpecificLoss.
    // A named catalog parameter or a person's staged value can explicitly state zero as well.
    return (
      drop?.catalogDropInWg != null ||
      work?.terminalDrops[String(node.id)]?.staged?.value !== undefined
    );
  };
  const priced = reached.filter(
    (node) => dropKnown(node) && !next.paths[node.id]!.rows.some((row) => row.error),
  );
  reason(
    "terminal-drop-authority",
    selectedTerminals.filter((node) => !dropKnown(node)).length,
    "An assigned connector loss, including SpecificLoss/zero, does not attest catalog provenance; name a catalog parameter or stage an explicit terminal drop",
  );
  reason(
    "unreached-terminals",
    selectedTerminals.length - reached.length,
    "Expected terminals have no calculated path",
  );
  reason(
    "unpriced-terminals",
    reached.length - priced.length,
    "Calculated paths contain unpriced rows or lack stated terminal catalog losses; totals include known arithmetic contributions only",
  );
  reason(
    "unknown-terminal-flow",
    selectedTerminals.filter((node) => terminalCfm(node) == null).length,
    "Terminal design flow is unknown",
  );
  const selectedNodes = snapshot.nodes.filter((node) => groupIds.has(node.groupId ?? ""));
  reason(
    "unreadable-model-store",
    snapshot.storeError ? 1 : 0,
    "The model loss store is unreadable; applied table and provenance choices are unknown",
  );
  reason(
    "native-family-coefficient-parity",
    selectedNodes.filter((node) =>
      node.facts.some(
        (fact) => fact.key === "familyCoefficient" && fact.value != null && fact.value > 0,
      ),
    ).length,
    "Shared arithmetic does not apply the native positive family-coefficient precedence",
  );
  reason(
    "staged-assumptions-not-physical",
    Object.values(work?.assumptions ?? {}).filter((cell) => cell.staged != null).length,
    "Staged assumptions affect readiness but are not all consumed by the numerical solver",
  );
  reason(
    "native-accessory-drop-parity",
    selectedNodes.filter(
      (node) =>
        node.kind === "accessory" &&
        node.facts.some((fact) => fact.key === "pressureDrop" && fact.value != null),
    ).length,
    "Shared arithmetic prices accessories by table or staged drop; native own-drop precedence is not verified",
  );
  reason(
    "native-negative-coefficient-parity",
    reached.filter((node) => next.paths[node.id]!.rows.some((row) => row.c != null && row.c < 0))
      .length,
    "Native coefficient clamping differs from the current shared arithmetic",
  );
  reason(
    "no-terminal-demand",
    selectedTerminals.length ? 0 : 1,
    "No terminal demand was available for this selection",
  );
  const ownEquipment =
    selector.kind === "document"
      ? equipmentIds
      : selector.kind === "equipment"
        ? equipmentIds.filter((id) => id === selector.id)
        : equipmentIds.filter((unit) =>
            groups.some(
              (group) => group.rootIds.includes(unit) || unitOf(snapshot, next, group) === unit,
            ),
          );
  reason(
    "unserved-equipment",
    ownEquipment.filter(
      (id) =>
        !groups.some((group) => group.rootIds.includes(id) || unitOf(snapshot, next, group) === id),
    ).length,
    "Equipment is present but has no resolved served group; role and demand remain unknown",
  );
  const independentStreams = (unit: number) =>
    new Set(
      snapshot.groups
        .filter((group) => group.rootIds.includes(unit) || unitOf(snapshot, next, group) === unit)
        .flatMap((group) => group.classifications),
    ).size > 1;
  reason(
    "unresolved-fan-circuits",
    ownEquipment.filter(independentStreams).length,
    "Multiple air classifications serve this equipment; the model does not establish a shared physical fan circuit. Classification maxima are retained; their sum is arithmetic, not a verified single-fan ESP",
  );
  const baseRow = (node: DuctSnapshot["nodes"][number] | undefined, elementId: number) => ({
    id: elementId,
    label: node ? label(node) : String(elementId),
    groupIds: groups
      .filter((group) => group.rootIds.includes(elementId) || group.id === node?.groupId)
      .map((group) => group.id),
    availableFanStaticInWg:
      node?.facts.find((fact) => fact.key === "externalStatic")?.value ?? null,
    flowCfm:
      node?.kind === "equipment"
        ? (node.facts.find((fact) => fact.key === "fanFlow")?.value ?? null)
        : node
          ? terminalCfm(node)
          : null,
    spaceText: node ? space(node) : null,
    detail: null,
    path: null,
    classificationParts: [],
    servedGroupState: null,
  });
  let rows: DuctsAnalysisResponse["rows"];
  if (request.projection === "summary")
    rows = ownEquipment.map((unit) => ({
      ...baseRow(nodes.get(unit), unit),
      kind: "equipment",
      servedGroupState: groups.some(
        (group) => group.rootIds.includes(unit) || unitOf(snapshot, next, group) === unit,
      )
        ? "observed"
        : "unknown",
      requiredEspNowInWg: independentStreams(unit)
        ? null
        : (proposedStatic(snapshot, now, unit)?.total ?? null),
      requiredEspStagedInWg: independentStreams(unit)
        ? null
        : (proposedStatic(snapshot, next, unit)?.total ?? null),
      classificationParts: (proposedStatic(snapshot, next, unit)?.parts ?? []).map((part) => ({
        classification: part.kind,
        nowInWg:
          proposedStatic(snapshot, now, unit)?.parts.find((now) => now.kind === part.kind)?.fan ??
          null,
        stagedInWg: part.fan,
      })),
    }));
  else if (request.projection === "terminals")
    rows = selectedTerminals.map((node) => ({
      ...baseRow(node, node.id),
      kind: "terminal",
      requiredEspNowInWg: now.paths[node.id]?.total ?? null,
      requiredEspStagedInWg: next.paths[node.id]?.total ?? null,
    }));
  else
    rows = reached.flatMap((node) =>
      next.paths[node.id]!.rows.map((row) => ({
        ...baseRow(nodes.get(row.id), row.id),
        kind: "path" as const,
        path: {
          terminalId: node.id,
          componentKind: row.kind,
          lossInWg: row.error ? null : row.dp,
          coefficient: row.c ?? null,
          table: row.table ?? null,
          velocityPressureInWg: row.pv ?? null,
          velocityFpm: row.fpm ?? null,
          lookup: row.inputs
            ? {
                result: row.inputs.res,
                x: row.inputs.x,
                y: row.inputs.y ?? null,
                xLabel: row.inputs.xLabel,
                yLabel: row.inputs.yLabel ?? null,
              }
            : null,
          error: row.error ?? null,
        },
        groupIds: [node.groupId!],
        requiredEspNowInWg: null,
        requiredEspStagedInWg: null,
        detail: `terminal ${node.id}; ${row.desc}${row.error ? `; UNPRICED: ${row.error}` : ""}`,
      })),
    );
  const basis = sha256Hex(
    JSON.stringify({ id, selector, projection: request.projection, limit: request.limit }),
  );
  if (request.cursor && request.cursor.basis !== basis)
    throw Error("Cursor does not belong to this analysis, selector, projection and limit");
  const offset = request.cursor?.offset ?? 0;
  const pageRows = rows.slice(offset, offset + request.limit);
  return {
    analysisId: id,
    artifact: {
      id,
      url: `/pe/ducts/analyses/${id}/artifact`,
      sha256: id,
      byteSize,
      format: "ducts-analysis-v1",
    },
    mode: request.source.kind === "fresh" ? "fresh" : "historical",
    target: artifact.observation.target,
    work: { kind: artifact.work.kind, revision: artifact.work.revision },
    freshness:
      request.source.kind === "fresh"
        ? artifact.freshness
        : {
            ...artifact.freshness,
            state: "historical",
            reason: `Retained observation; acquisition was ${artifact.freshness.state}. No native or Work read was made.`,
          },
    selection: {
      state,
      total:
        selector.kind === "space-text" || selector.kind === "terminal"
          ? selectedTerminals.length
          : selector.kind === "equipment"
            ? ownEquipment.length
            : groups.length,
      candidates: selectedTerminals.slice(0, 100).map((node) => node.id),
    },
    completeness: {
      basis: "staged-demand",
      verdict: state === "not-found" ? "unknown" : reasons.size ? "partial" : "complete",
      reasons: [...reasons.values()],
      expectedTerminals,
      reachedTerminals: reached.length,
      pricedTerminals: priced.length,
      spaceTextHave: selectedTerminals.filter((node) => space(node)).length,
      spaceTextOf: selectedTerminals.length,
    },
    coverage: {
      groups: snapshot.groups.length,
      equipment: equipmentIds.length,
      terminals: terminals.length,
      scope:
        "Collected HVAC-connector graph. Equipment without HVAC connectors and stable room identity are outside this snapshot.",
    },
    rows: pageRows,
    page: {
      total: rows.length,
      returned: pageRows.length,
      nextCursor:
        offset + pageRows.length < rows.length ? { offset: offset + pageRows.length, basis } : null,
    },
  };
}

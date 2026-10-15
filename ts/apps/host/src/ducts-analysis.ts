import { createPeClient } from "@pe/agent-contracts/pe-api";
import { contextFetch } from "@pe/runtime/context";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { readFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { join } from "node:path";
import {
  addressSchema,
  bindWork,
  ductsDocumentSchema,
  stagedDucts,
  type DuctPortPin,
  type DuctComponentWitness,
  type DocumentRef,
  type DuctsRouteDocument,
  type WorkKey,
  type DuctsAnalysisRequest,
  type DuctsAnalysisResponse,
} from "@pe/agent-contracts";
import { assessDucts } from "@pe/ducts-domain/assessment";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { price, proposedStatic, TABLE_IDS } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import { terminalCfm } from "@pe/ducts-domain/topology";
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
type Outputs = ReturnType<typeof solve>;
type ComponentFlow = Outputs["next"]["design"]["componentFlows"][number];
type StoredComponentFlow = Omit<ComponentFlow, "componentWitness"> & { witnessElements: number[] };
type StoredSide = Omit<Outputs["now"], "design"> & {
  design: Omit<Outputs["now"]["design"], "componentFlows"> & {
    componentFlows: StoredComponentFlow[];
  };
};
type StoredOutputs = Omit<Outputs, "now" | "next"> & { now: StoredSide; next: StoredSide };

/** One immutable artifact pool; identity includes geometry AND the scenario's role partition. */
function storeOutputs(outputs: Outputs) {
  const witnessElements: DuctComponentWitness = [];
  const positions = new Map<string, number>();
  const side = (value: Outputs["now"]): StoredSide => ({
    ...value,
    design: {
      ...value.design,
      componentFlows: value.design.componentFlows.map(
        ({ id, elementIds, componentWitness, ...rest }) => ({
          id,
          elementIds,
          witnessElements: componentWitness.map((element) => {
            const content = JSON.stringify(element);
            let position = positions.get(content);
            if (position === undefined) {
              position = witnessElements.length;
              positions.set(content, position);
              witnessElements.push(element);
            }
            return position;
          }),
          ...rest,
        }),
      ),
    },
  });
  return {
    witnessElements,
    outputs: { ...outputs, now: side(outputs.now), next: side(outputs.next) },
  };
}
function hydrateOutputs(artifact: Artifact): Outputs {
  if (!Array.isArray(artifact.witnessElements)) throw Error("Analysis witness pool is missing");
  const side = (value: StoredSide): Outputs["now"] => ({
    ...value,
    design: {
      ...value.design,
      componentFlows: value.design.componentFlows.map(
        ({ id, elementIds, witnessElements, ...rest }) => ({
          id,
          elementIds,
          componentWitness: witnessElements.map((index) => {
            if (
              !Number.isSafeInteger(index) ||
              index < 0 ||
              index >= artifact.witnessElements.length
            )
              throw Error("Analysis witness reference is invalid");
            return structuredClone(artifact.witnessElements[index]!);
          }),
          ...rest,
        }),
      ),
    },
  });
  return {
    ...artifact.outputs,
    now: side(artifact.outputs.now),
    next: side(artifact.outputs.next),
  };
}

type Artifact = {
  format: "ducts-analysis-v4";
  createdAt: string;
  producer: unknown;
  observation: Observation;
  work: { kind: "canonical" | "observed-only"; key: WorkKey; revision: number | null };
  freshness: DuctsAnalysisResponse["freshness"];
  input: { encoding: "gzip-base64"; data: string; sha256: string; byteSize: number };
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
  witnessElements: DuctComponentWitness;
  outputs: StoredOutputs;
};
const MAX_BYTES = 64 * 1024 * 1024;
const space = (node: DuctSnapshot["nodes"][number]) =>
  node.facts.find((f) => f.key === "space")?.text ?? null;
const label = (node: DuctSnapshot["nodes"][number]) =>
  [node.family, node.type].filter(Boolean).join(" / ") || String(node.id);
const inputOf = (artifact: Artifact): EffectiveInputs => {
  if (artifact.format !== "ducts-analysis-v4")
    throw Error(
      "Unsupported analysis format; historical outputs were not recomputed or reinterpreted",
    );
  const input = artifact.input;
  if (
    input?.encoding !== "gzip-base64" ||
    typeof input.data !== "string" ||
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize <= 0 ||
    input.byteSize > MAX_BYTES ||
    typeof input.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    input.data.length > 4 * Math.ceil(MAX_BYTES / 3)
  )
    throw Error("Analysis effective-input encoding or size is invalid");
  const compressed = Buffer.from(input.data, "base64");
  if (!compressed.length || compressed.toString("base64") !== input.data)
    throw Error("Analysis effective-input base64 is not canonical");
  let bytes: Buffer;
  try {
    bytes = gunzipSync(compressed, { maxOutputLength: input.byteSize });
  } catch {
    throw Error("Analysis effective-input gzip failed or exceeded its declared byte budget");
  }
  if (bytes.length !== input.byteSize || sha256Hex(bytes) !== input.sha256)
    throw Error("Analysis effective-input integrity failed");
  const json = bytes.toString("utf8");
  if (!Buffer.from(json, "utf8").equals(bytes))
    throw Error("Analysis effective-input UTF8 is invalid");
  return JSON.parse(json) as EffectiveInputs;
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
      format: "ducts-analysis-v4",
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
        encoding: "gzip-base64",
        data: gzipSync(Buffer.from(inputJson, "utf8")).toString("base64"),
        sha256: sha256Hex(inputJson),
        byteSize: Buffer.byteLength(inputJson),
      },
      acquisition,
      ...storeOutputs(outputs),
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
  const outputs = hydrateOutputs(artifact);
  const { now, next } = outputs;
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const selector = request.selector;
  const assessment = assessDucts(snapshot, work, outputs, {
    selector,
    freshness: artifact.freshness,
  });
  const { groups, selectedTerminals, reached, equipment } = assessment;
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
    component: null,
    flow: null,
    circuit: null,
    port: null,
    classificationParts: [],
    servedGroupState: null,
  });
  let rows: DuctsAnalysisResponse["rows"];
  if (request.projection === "components")
    rows = assessment.componentFlows.map((c) => ({
      ...baseRow(undefined, c.elementIds[0]!),
      kind: "component",
      label: `Component ${c.id}`,
      flowCfm: null,
      requiredEspNowInWg: null,
      requiredEspStagedInWg: null,
      component: {
        id: c.id,
        status: c.status,
        nodeCount: c.nodeCount,
        edgeCount: c.edges.length,
        cycleRank: c.cycleRank,
        unknownEdges: c.unknownEdges,
        maxResidualCfm: c.maxResidualCfm,
        reasonCount: c.reasons.length,
        reasonsTruncated: c.reasons.length > 20,
        reasons: c.reasons.slice(0, 20),
        pressureCertification: "not-established-by-flow-check",
      },
    }));
  else if (request.projection === "flows")
    rows = assessment.componentFlows.flatMap((c) =>
      c.edges.map((e) => ({
        ...baseRow(nodes.get(e.elementId), e.elementId),
        kind: "flow" as const,
        label: e.id,
        flowCfm: e.signedCfm,
        requiredEspNowInWg: null,
        requiredEspStagedInWg: null,
        flow: { componentId: c.id, componentStatus: c.status, ...e },
      })),
    );
  else if (request.projection === "summary")
    rows = equipment.map((unit) => ({
      ...baseRow(nodes.get(unit.id), unit.id),
      kind: "equipment",
      servedGroupState: unit.servedGroupState,
      requiredEspNowInWg: unit.requiredEspNowInWg,
      requiredEspStagedInWg: unit.requiredEspStagedInWg,
      classificationParts: unit.classificationParts,
    }));
  else if (request.projection === "terminals")
    rows = selectedTerminals.map((node) => ({
      ...baseRow(node, node.id),
      kind: "terminal",
      requiredEspNowInWg: now.paths[node.id]?.total ?? null,
      requiredEspStagedInWg: next.paths[node.id]?.total ?? null,
    }));
  else if (request.projection === "path")
    rows = reached.flatMap((node) =>
      next.paths[node.id]!.rows.map((row) => ({
        ...baseRow(nodes.get(row.id), row.id),
        kind: "path" as const,
        path: {
          terminalId: node.id,
          circuitId: null,
          circuitSide: null,
          balancingInWg: null,
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
  else if (request.projection === "ports") {
    const elements = new Map([...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e]));
    const selected = new Set(
      selector.kind === "equipment" || selector.kind === "terminal"
        ? [selector.id]
        : selector.kind === "space-text"
          ? selectedTerminals.map((n) => n.id)
          : selector.kind === "document"
            ? [...elements.keys()]
            : [...elements.values()]
                .filter(
                  (e) =>
                    e.groupId === selector.id ||
                    ("kind" in e &&
                      e.kind === "equipment" &&
                      groups.some((g) => g.rootIds.includes(e.id))),
                )
                .map((e) => e.id),
    );
    rows = [...elements.values()]
      .filter((e) => selected.has(e.id))
      .sort((a, b) => a.id - b.id)
      .flatMap((e) =>
        e.connectors.map((c) => {
          const other = c.connectedTo ? elements.get(c.connectedTo.elementId) : undefined;
          const own = e.connectors.filter((p) => p.index === c.index);
          const otherPorts =
            other?.connectors.filter((p) => p.index === c.connectedTo?.connector) ?? [];
          const reciprocal =
            own.length === 1 &&
            otherPorts.length === 1 &&
            otherPorts[0]!.connectedTo?.elementId === e.id &&
            otherPorts[0]!.connectedTo?.connector === c.index;
          const pin: DuctPortPin | null =
            e.uniqueId && other?.uniqueId && reciprocal && c.connectedTo && c.point.length === 3
              ? {
                  index: c.index,
                  point: c.point as [number, number, number],
                  shape: c.shape,
                  diameterIn: c.diameterIn ?? null,
                  widthIn: c.widthIn ?? null,
                  heightIn: c.heightIn ?? null,
                  direction: c.direction,
                  connectedTo: {
                    id: c.connectedTo.elementId,
                    connector: c.connectedTo.connector,
                    uniqueId: other.uniqueId,
                  },
                }
              : null;
          return {
            ...baseRow(nodes.get(e.id), e.id),
            kind: "port" as const,
            requiredEspNowInWg: null,
            requiredEspStagedInWg: null,
            port: {
              origin: "native-snapshot",
              direction: c.direction,
              classification: c.classification ?? null,
              connection: c.connectedTo ?? null,
              reciprocal,
              section: {
                shape: c.shape,
                diameterIn: c.diameterIn ?? null,
                widthIn: c.widthIn ?? null,
                heightIn: c.heightIn ?? null,
                areaFt2: c.areaFt2 ?? null,
              },
              uniqueId: e.uniqueId ?? null,
              index: c.index,
              pin,
              reason: pin
                ? null
                : !e.uniqueId || (c.connectedTo && !other?.uniqueId)
                  ? "Native stable identity missing; no admissible evidence pin"
                  : !reciprocal
                    ? "Physical attachment is absent, ambiguous or not reciprocal"
                    : "Connector has no complete point",
            },
          };
        }),
      );
  } else {
    const circuitRows = assessment.circuits.flatMap<DuctsAnalysisResponse["rows"][number]>((c) => {
      const base = {
        ...baseRow(nodes.get(c.equipmentId), c.equipmentId),
        requiredEspNowInWg: null,
        requiredEspStagedInWg: null,
        flowCfm: c.flowCfm,
        circuit: {
          id: c.id,
          uniqueId: c.uniqueId,
          status: c.status,
          basis: "balanced-design-demand" as const,
          requiredExternalTotalPressureInWg: c.requiredExternalTotalPressureInWg,
          requiredExternalStaticPressureInWg: c.requiredExternalStaticPressureInWg,
          manufacturerEsp: null,
          inletPort: c.inlet.port,
          outletPort: c.outlet.port,
          inletElements: c.inlet.elementIds.length,
          outletElements: c.outlet.elementIds.length,
          reasons: c.reasons.slice(0, 20),
          reasonCount: c.reasons.length,
          reasonsTruncated: c.reasons.length > 20,
        },
      };
      if (request.projection === "circuits") return [{ ...base, kind: "circuit" as const }];
      return (["inlet", "outlet"] as const).flatMap((side) =>
        c[side].paths.flatMap((p) =>
          p.rows.map((row) => ({
            ...base,
            id: row.id,
            kind: "path" as const,
            path: {
              terminalId: p.terminalId,
              circuitId: c.id,
              circuitSide: side,
              balancingInWg: p.balancingInWg,
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
          })),
        ),
      );
    });
    rows = circuitRows;
  }
  const basis = sha256Hex(
    JSON.stringify({ id, selector, projection: request.projection, limit: request.limit }),
  );
  if (request.cursor && request.cursor.basis !== basis)
    throw Error("Cursor does not belong to this analysis, selector, projection and limit");
  const offset = request.cursor?.offset ?? 0;
  const pageRows = rows.slice(offset, offset + request.limit);
  const response: DuctsAnalysisResponse = {
    analysisId: id,
    artifact: {
      id,
      url: `/pe/ducts/analyses/${id}/artifact`,
      sha256: id,
      byteSize,
      format: "ducts-analysis-v4",
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
    selection: assessment.selection,
    completeness: assessment.completeness,
    coverage: assessment.coverage,
    rows: pageRows,
    page: {
      total: rows.length,
      returned: pageRows.length,
      truncated: offset > 0 || pageRows.length < rows.length,
      nextCursor:
        offset + pageRows.length < rows.length ? { offset: offset + pageRows.length, basis } : null,
    },
  };
  // Full input/witnesses stay in the artifact; every normal reading has a hard UTF-8 byte budget.
  const byteLimit = 65536;
  while (Buffer.byteLength(JSON.stringify(response), "utf8") > byteLimit && response.rows.length) {
    response.rows.pop();
    response.page.returned = response.rows.length;
    response.page.truncated = true;
    response.page.nextCursor = { offset: offset + response.rows.length, basis };
  }
  if (
    Buffer.byteLength(JSON.stringify(response), "utf8") > byteLimit ||
    (rows.length > offset && !response.rows.length)
  )
    throw Error(`Analysis reading exceeds 65536-byte budget; inspect full artifact ${id}`);
  return response;
}

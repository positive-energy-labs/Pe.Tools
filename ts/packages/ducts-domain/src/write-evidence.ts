import type { DuctsSnapshotWalk } from "@pe/host-contracts/generated";
import { canonicalRouteInput } from "@pe/agent-contracts";


const pick = <T, K extends keyof T>(value: T, ...keys: K[]): Pick<T, K> =>
  Object.fromEntries(keys.map(key => [key, value[key]])) as Pick<T, K>;
const set = <T>(values: readonly T[]): T[] =>
  [...values].sort((a, b) => canonicalRouteInput(a).localeCompare(canonicalRouteInput(b)));

// Positive projection of model facts. Vectors, curves, phase chronology and inline port pairs stay ordered.
// New transport diagnostics cannot silently become write dependencies.
const DuctDocument = (v: DuctsSnapshotWalk.Res.DuctDocument) => ({
  ...pick(v, "title", "networkBasedCalculations")
});
const DuctLevel = (v: DuctsSnapshotWalk.Res.DuctLevel) => ({
  ...pick(v, "id", "name", "elevationFt")
});
const DuctGroup = (v: DuctsSnapshotWalk.Res.DuctGroup) => ({
  ...pick(v, "id", "terminalCount", "elementCount", "loops"),
  rootIds: set(v.rootIds),
  classifications: set(v.classifications),
  systemNames: set(v.systemNames),
  issueIds: set(v.issueIds)
});
const DuctRef = (v: DuctsSnapshotWalk.Res.DuctRef) => ({
  ...pick(v, "elementId", "connector")
});
const DuctConnector = (v: DuctsSnapshotWalk.Res.DuctConnector) => ({
  ...pick(v, "index", "kind", "point", "shape", "size", "diameterIn", "widthIn", "heightIn", "flowCfm", "direction", "classification", "areaFt2", "facing", "widthAxis", "isPrimary", "isSecondary"),
  connectedTo: v.connectedTo == null ? v.connectedTo : DuctRef(v.connectedTo)
});
const DuctFact = (v: DuctsSnapshotWalk.Res.DuctFact) => ({
  ...pick(v, "key", "value", "text", "unit", "provenance")
});
const DuctLoss = (v: DuctsSnapshotWalk.Res.DuctLoss) => ({
  ...pick(v, "method", "serverId", "table", "coefficient", "specificLossInWg", "revitPressureDropInWg", "fields")
});
const DuctTerminalDrop = (v: DuctsSnapshotWalk.Res.DuctTerminalDrop) => ({
  ...pick(v, "assignedPressureDropInWg", "connectorLossMethod", "writable", "catalogDropInWg")
});
const DuctNode = (v: DuctsSnapshotWalk.Res.DuctNode) => ({
  ...pick(v, "id", "kind", "category", "family", "type", "partType", "levelId", "point", "groupId", "systemName", "classification", "label", "uniqueId", "phaseCreated", "phaseDemolished", "flowParameter", "reason"),
  connectors: set(v.connectors.map(DuctConnector)),
  facts: set(v.facts.map(DuctFact)),
  loss: v.loss == null ? v.loss : DuctLoss(v.loss),
  terminalDrop: v.terminalDrop == null ? v.terminalDrop : DuctTerminalDrop(v.terminalDrop)
});
const DuctRoughness = (v: DuctsSnapshotWalk.Res.DuctRoughness) => ({
  ...pick(v, "valueFt", "provenance")
});
const DuctRevitValues = (v: DuctsSnapshotWalk.Res.DuctRevitValues) => ({
  ...pick(v, "flowCfm", "velocityFpm", "frictionInWgPer100Ft", "pressureDropInWg")
});
const DuctSegment = (v: DuctsSnapshotWalk.Res.DuctSegment) => ({
  ...pick(v, "id", "kind", "curveKind", "type", "shape", "size", "diameterIn", "widthIn", "heightIn", "lengthFt", "polyline", "levelId", "groupId", "systemName", "classification", "uniqueId", "phaseCreated", "phaseDemolished", "reason", "insulationIn"),
  roughness: DuctRoughness(v.roughness),
  revit: DuctRevitValues(v.revit),
  connectors: set(v.connectors.map(DuctConnector))
});
const DuctFlow = (v: DuctsSnapshotWalk.Res.DuctFlow) => ({
  ...pick(v, "segmentId", "cfm", "provenance")
});
const DuctNearPort = (v: DuctsSnapshotWalk.Res.DuctNearPort) => ({
  ...pick(v, "elementId", "connector", "gapIn", "facingDot", "opposed", "aligned", "autoJoin", "cappedBy")
});
const DuctNearFace = (v: DuctsSnapshotWalk.Res.DuctNearFace) => ({
  ...pick(v, "kind", "elementId", "connector", "gapIn", "facingDot", "opposed", "atFt", "point")
});
const DuctNearBody = (v: DuctsSnapshotWalk.Res.DuctNearBody) => ({
  ...pick(v, "segmentId", "gapIn", "tapGapIn"),
  tapPoint: v.tapPoint
});
const DuctNear = (v: DuctsSnapshotWalk.Res.DuctNear) => ({
  ports: set(v.ports.map(DuctNearPort)),
  faces: set(v.faces.map(DuctNearFace)),
  bodies: set(v.bodies.map(DuctNearBody))
});
const DuctInline = (v: DuctsSnapshotWalk.Res.DuctInline) => ({
  ...pick(v, "segmentId", "atFt", "ports")
});
const DuctIssue = (v: DuctsSnapshotWalk.Res.DuctIssue) => ({
  ...pick(v, "id", "kind", "elementId", "connector", "point", "note"),
  near: v.near == null ? v.near : DuctNear(v.near),
  inline: v.inline == null ? v.inline : DuctInline(v.inline)
});
const DuctCoverage = (v: DuctsSnapshotWalk.Res.DuctCoverage) => ({
  ...pick(v, "have", "of")
});
const DuctLayer = (v: DuctsSnapshotWalk.Res.DuctLayer) => ({
  ...pick(v, "key", "title", "query", "provenance"),
  coverage: DuctCoverage(v.coverage)
});
const DuctSection = (v: DuctsSnapshotWalk.Res.DuctSection) => ({
  ...pick(v, "number", "flowCfm", "totalPressureLossInWg"),
  elementIds: set(v.elementIds)
});
const DuctSystem = (v: DuctsSnapshotWalk.Res.DuctSystem) => ({
  ...pick(v, "id", "name", "classification", "isWellConnected", "baseEquipmentId", "baseEquipmentConnector", "criticalPathLossInWg", "criticalPath"),
  sections: set(v.sections.map(DuctSection))
});
const DuctParameterSlots = (v: DuctsSnapshotWalk.Res.DuctParameterSlotOverrides) => ({
  ...pick(v, "fanStatic", "fanFlow", "componentDrop", "terminalDrop", "fittingCoefficient", "terminalFlow")
});
const DuctLossStore = (v: DuctsSnapshotWalk.Res.DuctLossStore) => ({
  ...pick(v, "version", "rules", "instances", "terminals", "terminalFlows", "equipmentFlows", "verdicts", "roles", "workRevision", "appliedAt"),
  slots: v.slots == null ? v.slots : DuctParameterSlots(v.slots)
});
const DuctPhaseViews = (v: DuctsSnapshotWalk.Res.DuctPhaseViews) => ({
  ...pick(v, "phase", "filter", "count")
});
const DuctPhases = (v: DuctsSnapshotWalk.Res.DuctPhases) => ({
  ...pick(v, "order"),
  views: set(v.views.map(DuctPhaseViews))
});
const DuctGroupCoverage = (v: DuctsSnapshotWalk.Res.DuctGroupCoverage) => ({
  ...pick(v, "groupId", "have", "of")
});
const DuctAirflowCandidate = (v: DuctsSnapshotWalk.Res.DuctAirflowCandidate) => ({
  ...pick(v, "slot", "where", "shared", "have", "of"),
  groups: set(v.groups.map(DuctGroupCoverage))
});
const DuctWalk = (v: DuctsSnapshotWalk.Res.DuctWalk) => ({
  // OpenEnd excludes elements already reached *at that instant*. Its candidate IDs and traversal
  // counters vary with Revit connector enumeration. Final elements/ports and measured near geometry
  // below are the model evidence; only scope and completeness belong to the walk's write boundary.
  ...pick(v, "startId", "truncated")
});
const DuctHealthTolerances = (v: DuctsSnapshotWalk.Res.DuctHealthTolerances) => ({
  ...pick(v, "candidateBoxIn", "autoJoinGapIn")
});
const Response = (v: DuctsSnapshotWalk.Res.Response) => ({
  ...pick(v, "coordinateEncoding", "storeError"),
  document: DuctDocument(v.document),
  levels: set(v.levels.map(DuctLevel)),
  groups: set(v.groups.map(DuctGroup)),
  nodes: set(v.nodes.map(DuctNode)),
  segments: set(v.segments.map(DuctSegment)),
  flows: set(v.flows.map(DuctFlow)),
  // A loop's reported closing element is traversal-dependent too. Preserve the complete physical
  // adjacency in nodes/segments: changing an actual cycle still invalidates this projection.
  issues: set(v.issues.filter(i => i.kind !== "loop").map(DuctIssue)),
  layers: set(v.layers.map(DuctLayer)),
  systems: set(v.systems.map(DuctSystem)),
  slots: DuctParameterSlots(v.slots),
  store: v.store == null ? v.store : DuctLossStore(v.store),
  phases: v.phases == null ? v.phases : DuctPhases(v.phases),
  airflowCandidates: v.airflowCandidates == null ? v.airflowCandidates : set(v.airflowCandidates.map(DuctAirflowCandidate)),
  fanFlowCandidates: v.fanFlowCandidates == null ? v.fanFlowCandidates : set(v.fanFlowCandidates.map(DuctAirflowCandidate)),
  walk: v.walk == null ? v.walk : DuctWalk(v.walk),
  tolerances: v.tolerances == null ? v.tolerances : DuctHealthTolerances(v.tolerances)
});
export const ductWriteEvidence = Response;


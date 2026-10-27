import type { DuctHydraulics } from "@pe/agent-contracts";
import { ductArithmeticError, type ComponentFlow } from "./component-flows.ts";
import type { physicalGraph, CircuitReason } from "./physical-graph.ts";
import { friction, sectionOf } from "./loss-physics.ts";
type Graph = ReturnType<typeof physicalGraph>;
type Endpoint = DuctHydraulics["laws"][number]["from"];
export interface HydraulicClosure {
  status: "complete-for-prescribed-flow" | "partial" | "inconsistent";
  mode: "prescribed-flow-demand";
  physicalComponentIds: string[];
  lawEvidence: {
    from: string;
    to: string;
    totalPressureDifferenceInWg: number;
    elementId: number | null;
    source: string;
  }[];
  physicalPortCount: number;
  coveredPhysicalPortCount: number;
  physicalPartCount: number;
  coveredPhysicalPartCount: number;
  lawCount: number;
  pressureComponentCount: number;
  maxPressureResidualInWg: number | null;
  ports: {
    elementId: number;
    index: number;
    relativePressureInWg: number | null;
    totalPressureInWg: number | null;
  }[];
  fanHeads: {
    id: string;
    elementId: number;
    flowCfm: number | null;
    requiredExternalTotalPressureInWg: number | null;
  }[];
  reasons: CircuitReason[];
}
const key = (id: number, index: number) => `${id}:${index}`;
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
type Law = { from: string; to: string; drop: number; owner: number | null; source: string };
/** Prescribed-flow total-pressure differences only; every constraint is retained for KVL checks. */
export function prescribedHydraulics(g: Graph, components: ComponentFlow[]): ComponentFlow[] {
  const designs = g.flowDesigns.flatMap(([name, design]) =>
    design.kind === "component-flow" && design.hydraulics !== null ? [{ name, design }] : [],
  );
  if (!designs.length) return components;
  const laws: Law[] = [],
    anchors: { at: string; pressure: number; physical: boolean }[] = [];
  const issues = new Map<number, CircuitReason[]>();
  const issue = (id: number, code: string, message: string) => {
    const row = { code, elementId: id, message };
    issues.set(id, [...(issues.get(id) ?? []), row]);
  };
  const ports = new Map(g.graph.ports.map((p) => [key(p.elementId, p.connector.index), p]));
  const flow = new Map<string, number | null>();
  for (const c of components)
    for (const e of c.edges)
      if (e.kind === "joint") {
        flow.set(e.from, e.signedCfm);
        flow.set(e.to, e.signedCfm === null ? null : -e.signedCfm);
      }
  for (const c of components)
    for (const b of c.boundaries)
      if (b.externalExchange)
        flow.set(b.port, c.status === "unique" ? b.externalExchange.ownerOutwardCfm : null);
  const add = (from: string, to: string, drop: number, owner: number | null, source: string) =>
    laws.push({ from, to, drop, owner, source });
  const endpoint = (p: Endpoint, witness: ComponentFlow) => {
    const w = witness.componentWitness.find(
      (w) => w.element.id === p.element.id && w.element.uniqueId === p.element.uniqueId,
    );
    const c = w?.ports.find((c) => c.index === p.port.index);
    if (
      !c ||
      JSON.stringify({
        index: c.index,
        point: c.point,
        shape: c.shape,
        diameterIn: c.diameterIn,
        widthIn: c.widthIn,
        heightIn: c.heightIn,
        direction: c.direction,
        connectedTo: c.connectedTo,
      }) !== JSON.stringify(p.port)
    )
      return null;
    return key(p.element.id, p.port.index);
  };
  const pressureStations = new Map<string, string>();
  for (const c of components)
    for (const edge of c.edges)
      if (edge.kind === "station-arm") pressureStations.set(edge.from, edge.to);
  for (const [at, p] of ports) {
    const s = g.segments.get(p.elementId);
    if (!s || s.curveKind !== "line" || s.polyline.length !== 2 || pressureStations.has(at))
      continue;
    const error = ductArithmeticError([...s.polyline, ...s.connectors.map((p) => p.point)], 1);
    if (
      !s.polyline.some(
        (end) => Math.hypot(...end.map((x, i) => x - p.connector.point[i]!)) <= error,
      )
    )
      pressureStations.set(at, `${at}:pressure-station`);
  }
  const pressureStation = (at: string) => pressureStations.get(at) ?? at;
  const byWitness = new Map<string, ComponentFlow[]>();
  for (const c of components) {
    const basis = JSON.stringify(c.componentWitness);
    byWitness.set(basis, [...(byWitness.get(basis) ?? []), c]);
  }
  const rejectedPressureEndpoints = new Set<string>();
  const requested = new Set<string>();
  for (const { name, design: d } of designs) {
    const matches = byWitness.get(JSON.stringify(d.componentWitness)) ?? [];
    const c = matches.length === 1 ? matches[0] : undefined;
    if (!c || c.status !== "unique") {
      for (const w of d.componentWitness)
        issue(
          w.element.id,
          "hydraulic-flow-not-unique",
          `${name}: exact component witness and unique prescribed flow are required`,
        );
      continue;
    }
    requested.add(c.id);
    const h = d.hydraulics!;
    for (const a of h.anchors) {
      const at = endpoint(a.at, c);
      if (!at)
        issue(
          a.at.element.id,
          "hydraulic-stale-anchor",
          "Pressure anchor does not match the complete native component witness",
        );
      else
        anchors.push({
          at,
          pressure: a.totalPressureInWg,
          physical: a.kind === "physical-boundary",
        });
    }
    for (const l of h.laws) {
      const from = endpoint(l.from, c),
        to = endpoint(l.to, c);
      const sameOwner = l.from.element.id === l.to.element.id;
      const ownerPorts = sameOwner
        ? (g.elements
            .get(l.from.element.id)
            ?.connectors.map((p) => key(l.from.element.id, p.index)) ?? [])
        : [from, to];
      const vector = l.portFlows.map((p) => ({ at: endpoint(p.at, c), q: p.signedCfm }));
      const exactVector =
        vector.length === ownerPorts.length &&
        new Set(vector.map((p) => p.at)).size === vector.length &&
        ownerPorts.every((k) => vector.some((p) => p.at === k)) &&
        vector.every((p) => p.at !== null && flow.get(p.at) != null && close(flow.get(p.at)!, p.q));
      const reciprocal = g.graph.joints.some(
        (j) => j.reciprocal && ((j.a === from && j.b === to) || (j.a === to && j.b === from)),
      );
      if (
        !exactVector ||
        !close(
          vector.reduce((s, p) => s + p.q, 0),
          0,
        ) ||
        (!sameOwner && !reciprocal)
      ) {
        issue(
          l.from.element.id,
          "hydraulic-law-flow-vector",
          "All owner port signed flows and split ratio must match; remote-port laws cannot replace missing physical parts",
        );
        continue;
      }
      const outward = from ? flow.get(from) : null;
      if (
        !from ||
        !to ||
        from === to ||
        outward == null ||
        !close(sameOwner ? -outward : outward, l.signedCfm)
      ) {
        issue(
          l.from.element.id,
          "hydraulic-law-off-design",
          "Port-to-port TOTAL law is foreign, stale or not at its signed source flow",
        );
        continue;
      }
      if (sameOwner && g.validFans.some((f) => f.value.element.id === l.from.element.id)) {
        issue(
          l.from.element.id,
          "hydraulic-active-role-law",
          "Use the exact admitted fan allocation; no cross-stream cabinet pressure law",
        );
        continue;
      }
      if (ownerPorts.length === 2 && l.signedCfm * l.totalPressureDifferenceInWg < -1e-9) {
        issue(
          l.from.element.id,
          "hydraulic-passive-energy-inconsistent",
          "Two-port passive pressure point would generate energy",
        );
        rejectedPressureEndpoints.add(from);
        rejectedPressureEndpoints.add(to);
        continue;
      }
      add(
        from,
        to,
        l.totalPressureDifferenceInWg,
        l.from.element.id === l.to.element.id ? l.from.element.id : null,
        l.source,
      );
    }
    for (const e of h.stationEquivalences) {
      const element = g.segments.get(e.element.id);
      const section = element
        ? sectionOf(element.shape, element.diameterIn, element.widthIn, element.heightIn)
        : null;
      const sameSections = e.ports.every(
        (p) =>
          p.shape === element?.shape &&
          (p.diameterIn ?? null) === (element?.diameterIn ?? null) &&
          (p.widthIn ?? null) === (element?.widthIn ?? null) &&
          (p.heightIn ?? null) === (element?.heightIn ?? null),
      );
      const keys = e.ports.map((port) => endpoint({ element: e.element, port }, c));
      const stations = new Set(keys.filter((k) => k !== null).map((k) => pressureStation(k!)));
      const station = stations.size === 1 ? [...stations][0] : undefined;
      const fullGroup = c.edges
        .flatMap((edge) => [edge.from, edge.to])
        .filter((at) => ports.has(at) && pressureStation(at) === station);
      if (
        !element ||
        !section ||
        !sameSections ||
        element.curveKind !== "line" ||
        keys.some((k) => k === null) ||
        !station ||
        ports.has(station) ||
        new Set(keys).size !== keys.length ||
        [...new Set(fullGroup)].some((at) => !keys.includes(at))
      ) {
        issue(
          e.element.id,
          "hydraulic-station-equivalence",
          "Only the complete exact native duct station may have a sourced cross-section pressure equivalence; tap losses are not implied zero",
        );
        continue;
      }
      for (const at of keys) add(at!, station, 0, e.element.id, e.source);
    }
    for (const a of h.fanAllocations) {
      const f = g.validFans.find(
        (f) =>
          f.value.element.id === a.element.id &&
          f.value.element.uniqueId === a.element.uniqueId &&
          JSON.stringify(f.value.inlet) === JSON.stringify(a.inlet) &&
          JSON.stringify(f.value.outlet) === JSON.stringify(a.outlet),
      );
      const q = a.outlet
        ? flow.get(key(a.element.id, a.outlet.index))
        : a.inlet
          ? -(flow.get(key(a.element.id, a.inlet.index)) ?? NaN)
          : null;
      if (!f || q == null || !close(q, a.flowCfm)) {
        issue(
          a.element.id,
          "hydraulic-fan-allocation",
          "Fan allocation must match an admitted physical fan at its prescribed flow",
        );
        continue;
      }
      add(
        a.inlet ? key(a.element.id, a.inlet.index) : `reservoir:${f.id}:in`,
        a.outlet ? key(a.element.id, a.outlet.index) : `reservoir:${f.id}:out`,
        -a.totalRiseInWg,
        null,
        a.source,
      );
    }
  }
  // Native reciprocal contact is one plane only when full coordinates and sections agree.
  for (const c of components)
    if (c.status === "unique")
      for (const e of c.edges) {
        if (e.signedCfm === null) continue;
        if (e.kind === "joint") {
          const a = ports.get(e.from)?.connector,
            b = ports.get(e.to)?.connector;
          if (
            a &&
            b &&
            sectionOf(a.shape, a.diameterIn, a.widthIn, a.heightIn) !== null &&
            sectionOf(b.shape, b.diameterIn, b.widthIn, b.heightIn) !== null &&
            JSON.stringify(a.point) === JSON.stringify(b.point) &&
            a.shape === b.shape &&
            (a.diameterIn ?? null) === (b.diameterIn ?? null) &&
            (a.widthIn ?? null) === (b.widthIn ?? null) &&
            (a.heightIn ?? null) === (b.heightIn ?? null)
          )
            add(
              e.from,
              e.to,
              0,
              null,
              "Native reciprocal contact, identical coordinate and section plane",
            );
          else if (
            !laws.some(
              (l) => (l.from === e.from && l.to === e.to) || (l.from === e.to && l.to === e.from),
            )
          )
            issue(
              e.elementId,
              "hydraulic-interface-unknown",
              "A reciprocal joint is not proven to be the same pressure interface",
            );
        } else if (e.kind === "duct-subrun") {
          const s = g.segments.get(e.elementId)!;
          const section = sectionOf(s.shape, s.diameterIn, s.widthIn, s.heightIn);
          if (
            !section ||
            e.lengthFt == null ||
            !(e.lengthFt > 0) ||
            !Number.isFinite(s.roughness.valueFt) ||
            s.roughness.valueFt < 0
          )
            issue(
              e.elementId,
              "hydraulic-friction-unknown",
              "Positive subrun geometry, section and sourced roughness are required",
            );
          else
            add(
              pressureStation(e.from),
              pressureStation(e.to),
              Math.sign(e.signedCfm) *
                friction(section, Math.abs(e.signedCfm), e.lengthFt, s.roughness.valueFt).dp,
              e.elementId,
              "Native straight subrun at prescribed flow; shared friction arithmetic",
            );
        }
      }
  for (const [id, p] of g.passives) {
    const from = key(id, p.ports[0].index),
      to = key(id, p.ports[1].index),
      q = flow.get(from);
    if (
      q == null ||
      flow.get(to) == null ||
      !close(q + flow.get(to)!, 0) ||
      !close(-q, p.loss.flowCfm)
    ) {
      issue(
        id,
        "hydraulic-passive-off-design",
        "Passive TOTAL point is admitted only in its stated port order and flow",
      );
      continue;
    }
    if (p.loss.flowCfm === 0 && p.loss.totalLossInWg !== 0) {
      issue(id, "hydraulic-nonzero-loss-at-zero-flow", "Nonzero passive loss at zero flow");
      continue;
    }
    add(from, to, p.loss.totalLossInWg, id, p.loss.source);
  }
  for (const [id, t] of g.terminals) {
    const at = key(id, t.port.index),
      q = flow.get(at),
      ambient = `ambient:${id}`;
    anchors.push({ at: ambient, pressure: t.boundaryTotalPressureInWg, physical: true });
    if (
      q == null ||
      !t.loss ||
      !close(Math.abs(q), t.loss.flowCfm) ||
      (q === 0 && t.loss.totalLossInWg !== 0)
    ) {
      issue(
        id,
        "hydraulic-terminal-law-unknown",
        "Exact terminal TOTAL point at prescribed flow is required",
      );
      continue;
    }
    add(at, ambient, -Math.sign(q) * t.loss.totalLossInWg, id, t.loss.source);
  }
  for (const f of g.validFans)
    for (const [side, pin] of [
      ["in", f.value.inlet],
      ["out", f.value.outlet],
    ] as const)
      if (!pin)
        anchors.push({
          at: `reservoir:${f.id}:${side}`,
          pressure: f.value.referenceTotalPressureInWg,
          physical: true,
        });
  const adjacency = new Map<string, { to: string; delta: number }[]>();
  for (const l of laws) {
    adjacency.set(l.from, [...(adjacency.get(l.from) ?? []), { to: l.to, delta: -l.drop }]);
    adjacency.set(l.to, [...(adjacency.get(l.to) ?? []), { to: l.from, delta: l.drop }]);
  }
  for (const a of anchors) if (!adjacency.has(a.at)) adjacency.set(a.at, []);
  const pressure = new Map<
    string,
    { local: number; group: number; physical: boolean; offset: number }
  >();
  const badGroups = new Set<number>();
  let group = 0;
  const groupResidual = new Map<number, number>();
  for (const start of adjacency.keys())
    if (!pressure.has(start)) {
      const queue = [start];
      pressure.set(start, { local: 0, group, physical: false, offset: 0 });
      for (let i = 0; i < queue.length; i++)
        for (const edge of adjacency.get(queue[i]!) ?? []) {
          const v = pressure.get(queue[i]!)!,
            candidate = v.local + edge.delta,
            old = pressure.get(edge.to);
          if (!old) {
            pressure.set(edge.to, { local: candidate, group, physical: false, offset: 0 });
            queue.push(edge.to);
          } else if (old.group === group) {
            const residual = Math.abs(old.local - candidate);
            groupResidual.set(group, Math.max(groupResidual.get(group) ?? 0, residual));
            if (!close(old.local, candidate)) badGroups.add(group);
          }
        }
      const declared = anchors.filter((a) => pressure.get(a.at)?.group === group),
        physical = declared.filter((a) => a.physical),
        chosen = physical[0] ?? declared[0];
      const offset = chosen ? chosen.pressure - pressure.get(chosen.at)!.local : 0;
      for (const a of physical.length ? physical : declared) {
        const residual = Math.abs(pressure.get(a.at)!.local + offset - a.pressure);
        groupResidual.set(group, Math.max(groupResidual.get(group) ?? 0, residual));
        if (!close(pressure.get(a.at)!.local + offset, a.pressure)) badGroups.add(group);
      }
      for (const at of queue) {
        const p = pressure.get(at)!;
        p.physical = physical.length > 0;
        p.offset = offset;
      }
      group++;
    }
  const ownerPortKeys = new Map<number, string[]>();
  for (const [at, p] of ports)
    ownerPortKeys.set(p.elementId, [...(ownerPortKeys.get(p.elementId) ?? []), at]);
  for (const [id, ownerPorts] of ownerPortKeys) {
    if (g.validFans.some((f) => f.value.element.id === id)) continue;
    if (ownerPorts.length < 2) continue;
    const values = ownerPorts.map((k) => ({ p: pressure.get(k), q: flow.get(k) }));
    if (
      values.some((v) => !v.p || v.q == null) ||
      new Set(values.map((v) => v.p!.group)).size !== 1
    )
      continue;
    const mass = values.reduce((s, v) => s + v.q!, 0),
      power = values.reduce((s, v) => s + v.q! * v.p!.local, 0);
    const scale = values.reduce((s, v) => s + Math.abs(v.q! * v.p!.local), 0);
    if (!close(mass, 0) || power > 1e-7 * Math.max(1, scale)) {
      issue(
        id,
        "hydraulic-passive-energy-inconsistent",
        `Passive signed port power ${power} CFM*in-wg generates energy or violates conservation`,
      );
      for (const v of values) badGroups.add(v.p!.group);
    }
  }
  for (const at of rejectedPressureEndpoints) {
    const p = pressure.get(at);
    if (p) badGroups.add(p.group);
  }
  const heads = g.validFans.map((f) => {
    const inlet = f.value.inlet
        ? key(f.value.element.id, f.value.inlet.index)
        : `reservoir:${f.id}:in`,
      outlet = f.value.outlet
        ? key(f.value.element.id, f.value.outlet.index)
        : `reservoir:${f.id}:out`,
      a = pressure.get(inlet),
      b = pressure.get(outlet);
    const qi = f.value.inlet ? flow.get(inlet) : null,
      qo = f.value.outlet ? flow.get(outlet) : null,
      q = qo ?? (qi == null ? null : -qi);
    const openFlowMissing = [f.value.inlet, f.value.outlet].some(
      (p) => p && p.connectedTo === null && flow.get(key(f.value.element.id, p.index)) == null,
    );
    const valid = !openFlowMissing && q != null && (qi == null || qo == null || close(-qi, qo));
    const determined =
      a &&
      b &&
      (a.group === b.group || (a.physical && b.physical)) &&
      !badGroups.has(a.group) &&
      !badGroups.has(b.group);
    return {
      id: f.id,
      elementId: f.value.element.id,
      flowCfm: valid ? q : null,
      requiredExternalTotalPressureInWg:
        valid && determined ? b.local + b.offset - a.local - a.offset : null,
    };
  });
  const componentPorts = new Map(
    components.map((c) => [
      c.id,
      new Set(
        [
          c.id,
          ...c.edges.flatMap((e) => [e.from, e.to]),
          ...c.boundaries.map((b) => b.port),
        ].filter((k) => ports.has(k)),
      ),
    ]),
  );
  const related = new Map(components.map((c) => [c.id, new Set<string>()]));
  for (const f of g.validFans) {
    const ids = components
      .filter((c) =>
        [f.value.inlet, f.value.outlet].some(
          (p) => p !== null && componentPorts.get(c.id)!.has(key(f.value.element.id, p.index)),
        ),
      )
      .map((c) => c.id);
    for (const a of ids) for (const b of ids) related.get(a)!.add(b);
  }
  return components.map((c) => {
    const scopeIds = new Set<string>(),
      pending = [c.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (scopeIds.has(id)) continue;
      scopeIds.add(id);
      pending.push(...related.get(id)!);
    }
    const scope = components.filter((c) => scopeIds.has(c.id)),
      elementIds = [...new Set(scope.flatMap((c) => c.elementIds))];
    const relevant = scope.some((member) =>
      designs.some(
        ({ design: d }) =>
          JSON.stringify(d.componentWitness.map((w) => w.element.id)) ===
          JSON.stringify(member.elementIds),
      ),
    );
    if (!relevant) return c;
    const reasons: CircuitReason[] = elementIds.flatMap((id) => issues.get(id) ?? []);
    if (scope.some((c) => c.status !== "unique"))
      reasons.push({
        code: "hydraulic-related-flow-unknown",
        elementId: null,
        message: "Every exact fan-linked physical component needs unique prescribed flow",
      });
    if (![...scopeIds].some((id) => requested.has(id)))
      reasons.push({
        code: "hydraulic-flow-not-unique",
        elementId: null,
        message: "Whole-component unique prescribed flow and exact edit witness are required",
      });
    const physicalPorts = [...new Set(scope.flatMap((c) => [...componentPorts.get(c.id)!]))];
    let coveredParts = 0;
    for (const id of elementIds) {
      const e = g.elements.get(id)!,
        partPorts = physicalPorts.filter((k) => ports.get(k)?.elementId === id);
      const fan = g.validFans.some((f) => f.value.element.id === id);
      if (
        fan ||
        e.kind === "cap" ||
        (e.kind === "terminal" &&
          partPorts.every((k) => laws.some((l) => l.owner === id && (l.from === k || l.to === k))))
      ) {
        coveredParts++;
        continue;
      }
      const local = new Map<string, string[]>();
      for (const l of laws.filter((l) => l.owner === id)) {
        local.set(l.from, [...(local.get(l.from) ?? []), l.to]);
        local.set(l.to, [...(local.get(l.to) ?? []), l.from]);
      }
      const reached = new Set<string>(),
        todo = partPorts[0] ? [partPorts[0]] : [];
      while (todo.length) {
        const at = todo.pop()!;
        if (reached.has(at)) continue;
        reached.add(at);
        todo.push(...(local.get(at) ?? []));
      }
      if (
        partPorts.length > 0 &&
        partPorts.every((k) => reached.has(k)) &&
        scope
          .flatMap((c) => c.edges)
          .filter((e) => e.elementId === id && e.kind === "duct-subrun")
          .every((e) =>
            laws.some(
              (l) =>
                l.owner === id &&
                l.from === pressureStation(e.from) &&
                l.to === pressureStation(e.to),
            ),
          )
      )
        coveredParts++;
      else
        reasons.push({
          code: "hydraulic-part-law-unknown",
          elementId: id,
          message:
            "All actual physical ports need sourced port-to-port constitutive coverage; mass-only arms assert no pressure law",
        });
    }
    const fanHeads = heads.filter((f) => {
      const role = g.validFans.find((role) => role.id === f.id)!;
      return [role.value.inlet, role.value.outlet].some(
        (p) => p !== null && physicalPorts.includes(key(role.value.element.id, p.index)),
      );
    });
    for (const f of fanHeads)
      if (f.requiredExternalTotalPressureInWg == null)
        reasons.push({
          code: "hydraulic-fan-head-underdetermined",
          elementId: f.elementId,
          message:
            "Required head needs linked pressure planes or independently sourced physical references/allocation; no equal sharing",
        });
    const groups = new Set(
      physicalPorts.flatMap((k) => (pressure.has(k) ? [pressure.get(k)!.group] : [])),
    );
    if ([...groups].some((k) => badGroups.has(k)))
      reasons.push({
        code: "hydraulic-pressure-inconsistent",
        elementId: null,
        message:
          "Signed TOTAL pressure constraints/anchors fail full-cycle KVL; no implicit balancing variable",
      });
    const scopePressureRows = physicalPorts.map((at) => {
      const p = pressure.get(at),
        native = ports.get(at)!;
      return {
        elementId: native.elementId,
        index: native.connector.index,
        relativePressureInWg: p && !badGroups.has(p.group) ? p.local + p.offset : null,
        totalPressureInWg: p?.physical && !badGroups.has(p.group) ? p.local + p.offset : null,
      };
    });
    const covered = scopePressureRows.filter((p) => p.relativePressureInWg !== null).length;
    if (covered !== physicalPorts.length)
      reasons.push({
        code: "hydraulic-port-uncovered",
        elementId: null,
        message: "Physical port pressure is not constrained; missing laws remain unknown",
      });
    const localPorts = componentPorts.get(c.id)!;
    const resultPorts = scopePressureRows.filter((p) => localPorts.has(key(p.elementId, p.index)));
    const localPressureVertices = new Set([
      ...localPorts,
      ...c.edges.flatMap((e) => [pressureStation(e.from), pressureStation(e.to)]),
    ]);
    const hydraulics: HydraulicClosure = {
      status: reasons.some(
        (r) =>
          r.code === "hydraulic-pressure-inconsistent" ||
          r.code === "hydraulic-passive-energy-inconsistent",
      )
        ? "inconsistent"
        : reasons.length
          ? "partial"
          : "complete-for-prescribed-flow",
      mode: "prescribed-flow-demand",
      physicalComponentIds: [...scopeIds].sort(),
      lawEvidence: laws
        .filter((l) => localPressureVertices.has(l.from) || localPressureVertices.has(l.to))
        .map((l) => ({
          from: l.from,
          to: l.to,
          totalPressureDifferenceInWg: l.drop,
          elementId: l.owner,
          source: l.source,
        })),
      physicalPortCount: physicalPorts.length,
      coveredPhysicalPortCount: covered,
      physicalPartCount: elementIds.length,
      coveredPhysicalPartCount: coveredParts,
      lawCount: laws.filter(
        (l) =>
          c.elementIds.some((id) => l.owner === id) ||
          physicalPorts.includes(l.from) ||
          physicalPorts.includes(l.to),
      ).length,
      pressureComponentCount: groups.size,
      maxPressureResidualInWg: [...scopeIds].some((id) => requested.has(id))
        ? Math.max(0, ...[...groups].map((g) => groupResidual.get(g) ?? 0))
        : null,
      ports: resultPorts,
      fanHeads,
      reasons,
    };
    return { ...c, hydraulics };
  });
}

/**
 * One duct group as the engineer reasons about it: a tree from the fan out to each register.
 * Demand sums from the terminals up to the root (pass-1 flow, from `ducts.snapshot`); loss will
 * sum from the root out to the terminals. Pure and derived: the tree view and the ledger read
 * the same `groupTree`, and nothing here is stored.
 * - The root is the one equipment port. A group with none or many gets a stand-in root, and
 *   `rootWord` says which and why; a tree is never rooted silently.
 * - Developed length is straight duct only. Fitting equivalent lengths need the loss solver.
 * - The longest developed run stands in for the Manual D critical path until that solver exists.
 */
import type { DuctSnapshot } from "./readiness";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Node["connectors"][number];
type Issue = DuctSnapshot["issues"][number];

/** An equipment port and the group element it feeds; a stand-in root has no port. */
export interface RootPort {
  equipment: number | null;
  port: number | null;
  element: number;
}

/** One group element: a node (fitting, terminal, …) or a segment (duct, flex). */
export interface Part {
  id: number;
  node: Node | null;
  segment: Segment | null;
  /** Straight length, ft; fittings and terminals are 0. */
  lengthFt: number;
  /** Pass-1 flow on a segment; null elsewhere and where C# could not sum. */
  cfm: number | null;
}

export interface GroupTree {
  groupId: string;
  root: RootPort | null;
  /** The root rule as a sentence: which port, and why it was chosen. */
  rootWord: string;
  /** Whether the root is the group's one equipment port, or a stand-in. */
  rooted: "port" | "stand-in";
  extraRoots: RootPort[];
  parts: Map<number, Part>;
  /** Breadth-first from the root element; unreached elements are appended as their own roots. */
  order: number[];
  parent: Map<number, number | null>;
  children: Map<number, number[]>;
  /** Developed straight length from the root to the far end of each element, ft. */
  dist: Map<number, number>;
  /** Connections that close a loop: the walk reached both ends another way. */
  backEdges: [number, number][];
  terminals: number[];
  /** Root to the terminal with the most developed length; empty with no terminal. */
  longest: number[];
  issuesByElement: Map<number, Issue[]>;
}

const area = (s: Segment) =>
  s.diameterIn != null ? (Math.PI * s.diameterIn ** 2) / 4 : (s.widthIn ?? 0) * (s.heightIn ?? 0);

export const terminalCfm = (node: Node | null | undefined) => {
  const fact = node?.facts.find((f) => f.key === "flow");
  return fact?.value ?? null;
};

export function groupTree(snapshot: DuctSnapshot, groupId: string): GroupTree {
  const group = snapshot.groups.find((g) => g.id === groupId);
  const flows = new Map(snapshot.flows.map((f) => [f.segmentId, f.cfm]));
  const parts = new Map<number, Part>();
  for (const node of snapshot.nodes)
    if (node.groupId === groupId)
      parts.set(node.id, { id: node.id, node, segment: null, lengthFt: 0, cfm: null });
  for (const segment of snapshot.segments)
    if (segment.groupId === groupId)
      parts.set(segment.id, {
        id: segment.id,
        node: null,
        segment,
        lengthFt: segment.lengthFt,
        cfm: flows.get(segment.id) ?? null,
      });
  const connectors = (part: Part): Connector[] =>
    part.node?.connectors ?? part.segment?.connectors ?? [];

  // Undirected adjacency inside the group; equipment ports are attachments, as in C#.
  const rootIds = new Set(group?.rootIds ?? []);
  const equipment = snapshot.nodes.filter((n) => rootIds.has(n.id));
  const adjacent = new Map<number, number[]>([...parts.keys()].map((id) => [id, []]));
  const ports = new Map<string, RootPort>();
  const attach = (port: RootPort) => ports.set(`${port.equipment}:${port.port}`, port);
  for (const part of parts.values())
    for (const c of connectors(part)) {
      const to = c.connectedTo;
      if (!to || to.elementId === part.id) continue;
      if (parts.has(to.elementId)) {
        const list = adjacent.get(part.id)!;
        if (!list.includes(to.elementId)) list.push(to.elementId);
      } else if (rootIds.has(to.elementId))
        attach({ equipment: to.elementId, port: to.connector, element: part.id });
    }
  for (const eq of equipment)
    for (const c of eq.connectors)
      if (c.connectedTo && parts.has(c.connectedTo.elementId))
        attach({ equipment: eq.id, port: c.index, element: c.connectedTo.elementId });
  for (const list of adjacent.values()) list.sort((a, b) => a - b);
  const allPorts = [...ports.values()].sort(
    (a, b) => a.equipment! - b.equipment! || a.port! - b.port!,
  );

  const terminalIds = [...parts.values()]
    .filter((p) => p.node?.kind === "terminal")
    .map((p) => p.id);
  const { root, rootWord, rooted } = chooseRoot(allPorts, parts, adjacent, terminalIds);
  const extraRoots = allPorts.filter((p) => p !== root);

  // Breadth-first from the root element; a second reach of a visited element closes a loop.
  const parent = new Map<number, number | null>();
  const children = new Map<number, number[]>([...parts.keys()].map((id) => [id, []]));
  const order: number[] = [];
  const backEdges: [number, number][] = [];
  const seen = new Set<string>();
  const walk = (start: number) => {
    parent.set(start, null);
    const queue = [start];
    while (queue.length) {
      const x = queue.shift()!;
      order.push(x);
      for (const y of adjacent.get(x)!) {
        if (y === parent.get(x)) continue;
        const edge = x < y ? `${x}-${y}` : `${y}-${x}`;
        if (seen.has(edge)) continue;
        seen.add(edge);
        if (parent.has(y)) backEdges.push([x, y]);
        else {
          parent.set(y, x);
          children.get(x)!.push(y);
          queue.push(y);
        }
      }
    }
  };
  if (root) walk(root.element);
  for (const id of [...parts.keys()].sort((a, b) => a - b)) if (!parent.has(id)) walk(id);

  const dist = new Map<number, number>();
  for (const id of order) {
    const up = parent.get(id);
    dist.set(id, (up == null ? 0 : dist.get(up)!) + parts.get(id)!.lengthFt);
  }
  const reached = new Set<number>();
  if (root) {
    const stack = [root.element];
    while (stack.length) {
      const x = stack.pop()!;
      reached.add(x);
      stack.push(...children.get(x)!);
    }
  }
  const far = terminalIds
    .filter((t) => reached.has(t))
    .sort((a, b) => dist.get(b)! - dist.get(a)! || a - b)[0];
  const longest = far == null ? [] : pathTo(parent, far);

  const issuesByElement = new Map<number, Issue[]>();
  for (const issue of snapshot.issues)
    if (issue.groupId === groupId && issue.elementId != null)
      issuesByElement.set(issue.elementId, [
        ...(issuesByElement.get(issue.elementId) ?? []),
        issue,
      ]);

  return {
    groupId,
    root,
    rootWord,
    rooted,
    extraRoots,
    parts,
    order,
    parent,
    children,
    dist,
    backEdges,
    terminals: terminalIds,
    longest,
    issuesByElement,
  };
}

/** Root to `id`, inclusive. */
export const pathTo = (parent: ReadonlyMap<number, number | null>, id: number) => {
  const path = [id];
  for (let up = parent.get(id); up != null; up = parent.get(up)) path.unshift(up);
  return path;
};

/**
 * The one port, else a stated stand-in. Many ports: the port nearest (in hops) to the most
 * terminals, ties to the lowest equipment id and port. None: the largest duct cross-section.
 */
function chooseRoot(
  ports: RootPort[],
  parts: ReadonlyMap<number, Part>,
  adjacent: ReadonlyMap<number, number[]>,
  terminals: number[],
): { root: RootPort | null; rootWord: string; rooted: "port" | "stand-in" } {
  if (ports.length === 1)
    return {
      root: ports[0]!,
      rootWord: `rooted at equipment ${ports[0]!.equipment} port ${ports[0]!.port}, the group's one equipment port`,
      rooted: "port",
    };
  if (ports.length > 1) {
    const claim = new Map<number, number>();
    const queue = ports.map((port, index) => ({ id: port.element, index }));
    const owner = new Map<number, number>();
    for (const { id, index } of queue) if (!owner.has(id)) owner.set(id, index);
    while (queue.length) {
      const { id, index } = queue.shift()!;
      if (owner.get(id) !== index) continue;
      for (const y of adjacent.get(id)!)
        if (!owner.has(y)) {
          owner.set(y, index);
          queue.push({ id: y, index });
        }
    }
    for (const t of terminals) {
      const index = owner.get(t);
      if (index != null) claim.set(index, (claim.get(index) ?? 0) + 1);
    }
    const best = ports
      .map((port, index) => ({ port, count: claim.get(index) ?? 0 }))
      .sort((a, b) => b.count - a.count)[0]!;
    return {
      root: best.port,
      rootWord: `stand-in root: ${ports.length} equipment ports feed this group; drawn from equipment ${best.port.equipment} port ${best.port.port}, nearest to ${best.count} of ${terminals.length} terminals; the other ports are marked`,
      rooted: "stand-in",
    };
  }
  const trunk = [...parts.values()]
    .filter((p) => p.segment)
    .sort((a, b) => area(b.segment!) - area(a.segment!) || a.id - b.id)[0];
  return {
    root: trunk ? { equipment: null, port: null, element: trunk.id } : null,
    rootWord: trunk
      ? `stand-in root: no equipment port feeds this group; drawn from its largest duct, ${trunk.id} (${trunk.segment!.size})`
      : "no root: no equipment port and no duct to draw from",
    rooted: "stand-in",
  };
}

/** A drawn edge: a straight chain of elements collapsed between two vertices of the tree. */
export interface Chain {
  /** The vertex it hangs from; null for the root. */
  from: number | null;
  /** The vertex it ends on (its last member). */
  to: number;
  members: number[];
  lengthFt: number;
  /** The upstream member segment's pass-1 flow. */
  cfm: number | null;
  sizes: string[];
  fittings: number;
}

/**
 * The chains of the tree. An element is a vertex when it is a terminal, a cap, a branch or a
 * leaf, has an open end, closes a loop, meets an extra root, or is `forced` (an expanded chain);
 * every other element folds into the chain that passes through it.
 */
export function chainsOf(tree: GroupTree, forced: ReadonlySet<number> = new Set()): Chain[] {
  const loopEnds = new Set(tree.backEdges.flat());
  const extra = new Set(tree.extraRoots.map((r) => r.element));
  const vertex = (id: number) => {
    const part = tree.parts.get(id)!;
    return (
      forced.has(id) ||
      part.node?.kind === "terminal" ||
      part.node?.kind === "cap" ||
      tree.children.get(id)!.length !== 1 ||
      loopEnds.has(id) ||
      extra.has(id) ||
      (tree.issuesByElement.get(id) ?? []).some((i) => i.kind === "open-end")
    );
  };
  const chains: Chain[] = [];
  const grow = (from: number | null, first: number) => {
    const members = [first];
    let at = first;
    while (!vertex(at)) {
      at = tree.children.get(at)![0]!;
      members.push(at);
    }
    const parts = members.map((id) => tree.parts.get(id)!);
    const segments = parts.filter((p) => p.segment);
    chains.push({
      from,
      to: at,
      members,
      lengthFt: segments.reduce((sum, p) => sum + p.lengthFt, 0),
      cfm: segments.find((p) => p.cfm != null)?.cfm ?? null,
      sizes: segments
        .map((p) => p.segment!.size)
        .filter((size, i, all) => i === 0 || size !== all[i - 1]),
      fittings: parts.filter((p) => p.node?.kind === "fitting").length,
    });
    for (const child of tree.children.get(at)!) grow(at, child);
  };
  for (const id of tree.order) if (tree.parent.get(id) === null) grow(null, id);
  return chains;
}

/** One run from the root out to one terminal: the Manual D worksheet's row. */
export interface Run {
  terminal: number;
  path: number[];
  developedFt: number;
  /** Fittings on the path by `partType` (Elbow, Tee, Transition, …). */
  fittings: Record<string, number>;
  accessories: number;
  terminalCfm: number | null;
  /** Revit's reported pressure drop summed over the path's segments that report one. */
  revitDropInWg: number | null;
  revitDropCoverage: { have: number; of: number };
  issues: Issue[];
  longest: boolean;
}

/** Every terminal the root reaches, longest developed length first. */
export function runsOf(tree: GroupTree): Run[] {
  const far = tree.longest.at(-1);
  return tree.terminals
    .filter((t) => tree.root && pathTo(tree.parent, t)[0] === tree.root.element)
    .map((terminal) => {
      const path = pathTo(tree.parent, terminal);
      const parts = path.map((id) => tree.parts.get(id)!);
      const segments = parts.filter((p) => p.segment);
      const drops = segments.flatMap((p) => p.segment!.revit.pressureDropInWg ?? []);
      const fittings: Record<string, number> = {};
      for (const p of parts)
        if (p.node?.kind === "fitting") {
          const kind = p.node.partType ?? "fitting";
          fittings[kind] = (fittings[kind] ?? 0) + 1;
        }
      return {
        terminal,
        path,
        developedFt: tree.dist.get(terminal)!,
        fittings,
        accessories: parts.filter((p) => p.node?.kind === "accessory").length,
        terminalCfm: terminalCfm(tree.parts.get(terminal)!.node),
        revitDropInWg: drops.length ? drops.reduce((a, b) => a + b, 0) : null,
        revitDropCoverage: { have: drops.length, of: segments.length },
        issues: path.flatMap((id) => tree.issuesByElement.get(id) ?? []),
        longest: terminal === far,
      };
    })
    .sort((a, b) => b.developedFt - a.developedFt || a.terminal - b.terminal);
}

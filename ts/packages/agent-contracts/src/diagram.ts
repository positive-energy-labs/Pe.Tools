/**
 * Pea's `diagram` tool contract, and the one converter from it to mermaid (agent ledger,
 * 2026-09-16). The host validates a call against `diagramSpecSchema`; the web renders the same
 * args through `toMermaid` and `Code`. Both import this file, so the two cannot disagree.
 *
 * The converter writes only what `beautiful-mermaid`'s flowchart parser reads (`src/parser.ts`:
 * `flowchart <dir>`, `id["…"]`-style shapes, `-->`/`-.->`/`==>` with `|"…"|` labels,
 * `subgraph id ["…"]` … `end`), and is valid official mermaid too, so the copied source pastes.
 */
import { z } from "zod";

export const DIAGRAM_TOOL_ID = "diagram";

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export const diagramShapes = ["box", "round", "stadium", "circle", "diamond", "cylinder"] as const;
export const diagramEdgeStyles = ["solid", "dashed", "thick"] as const;

const idSchema = z
  .string()
  .regex(ID, "must start with a letter and use only letters, digits, _ or -, up to 40 characters");

export const diagramSpecSchema = z
  .object({
    title: z
      .string()
      .max(80)
      .optional()
      .describe("A short caption shown above the diagram, e.g. 'AHU-1 supply air'."),
    direction: z
      .enum(["TD", "LR", "BT", "RL"])
      .default("TD")
      .describe("Layout direction: TD top-down (default), LR left-right, BT, RL."),
    nodes: z
      .array(
        z.object({
          id: idSchema.describe(
            "Stable id that edges and groups refer to, e.g. 'AHU1' or 'vav-3'. Not shown.",
          ),
          label: z
            .string()
            .min(1)
            .max(80)
            .describe("Text shown in the node. Any characters; a newline starts a second line."),
          shape: z
            .enum(diagramShapes)
            .default("box")
            .describe(
              "box (default), round, stadium (terminal/start-end), circle, diamond (decision), cylinder (store).",
            ),
        }),
      )
      .min(1)
      .max(200)
      .describe("Every element of the diagram, 1 to 200."),
    edges: z
      .array(
        z.object({
          from: z.string().describe("Id of the node the edge leaves."),
          to: z.string().describe("Id of the node the edge enters."),
          label: z
            .string()
            .max(60)
            .optional()
            .describe("Text on the edge, e.g. an airflow like '1200 cfm'."),
          style: z
            .enum(diagramEdgeStyles)
            .default("solid")
            .describe("solid (default), dashed (secondary or planned), thick (main path)."),
        }),
      )
      .max(400)
      .describe("Directed connections between nodes, 0 to 400."),
    groups: z
      .array(
        z.object({
          id: idSchema.describe("Group id; must not equal any node id."),
          label: z.string().min(1).max(80).describe("Text shown on the group's box."),
          nodes: z.array(z.string()).describe("Ids of the nodes inside this group."),
        }),
      )
      .optional()
      .describe("Boxes around related nodes, e.g. one per main. A node belongs to at most one."),
  })
  .superRefine((spec, ctx) => {
    const nodeAt = new Map<string, number>();
    spec.nodes.forEach((node, index) => {
      if (nodeAt.has(node.id))
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `duplicate id "${node.id}"`,
        });
      else nodeAt.set(node.id, index);
    });
    const need = (id: string, path: (string | number)[]) => {
      if (!nodeAt.has(id)) ctx.addIssue({ code: "custom", path, message: `no node "${id}"` });
    };
    spec.edges.forEach((edge, index) => {
      need(edge.from, ["edges", index, "from"]);
      need(edge.to, ["edges", index, "to"]);
    });
    const groupIds = new Set<string>();
    const memberOf = new Map<string, string>();
    (spec.groups ?? []).forEach((group, index) => {
      if (groupIds.has(group.id))
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "id"],
          message: `duplicate group id "${group.id}"`,
        });
      groupIds.add(group.id);
      if (nodeAt.has(group.id))
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "id"],
          message: `"${group.id}" is already a node id`,
        });
      group.nodes.forEach((member, at) => {
        const path = ["groups", index, "nodes", at];
        need(member, path);
        const owner = memberOf.get(member);
        if (owner !== undefined)
          ctx.addIssue({
            code: "custom",
            path,
            message: `node "${member}" is already in group "${owner}"`,
          });
        else memberOf.set(member, group.id);
      });
    });
  });

export type DiagramSpec = z.output<typeof diagramSpecSchema>;
export type DiagramSpecInput = z.input<typeof diagramSpecSchema>;

/**
 * Label text as a quoted mermaid string that cannot close its node, edge, or group, start a
 * comment, or inject markup. Syntax characters become look-alike glyphs, not entities:
 * `renderMermaidSVG` decodes XML entities before parsing (`beautiful-mermaid` `src/index.ts`), so
 * `&#93;` would reopen the bracket it was meant to hide. A newline becomes `<br>`, which both
 * parsers read as a line break.
 */
const GLYPH: Record<string, string> = {
  '"': "＂",
  "[": "［",
  "]": "］",
  "(": "（",
  ")": "）",
  "{": "｛",
  "}": "｝",
  "|": "｜",
  "<": "‹",
  ">": "›",
  "&": "＆",
  "#": "＃",
  ";": "；",
  "%": "％",
  "\\": "＼",
  "*": "∗",
  "~": "～",
  "`": "ˋ",
};

export function mermaidLabel(text: string): string {
  const safe = text
    .replace(/["[\](){}|<>&#;%\\*~`]/g, (char) => GLYPH[char]!)
    .replace(/\t/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("<br>");
  return `"${safe}"`;
}

const SHAPE: Record<(typeof diagramShapes)[number], [string, string]> = {
  box: ["[", "]"],
  round: ["(", ")"],
  stadium: ["([", "])"],
  circle: ["((", "))"],
  diamond: ["{", "}"],
  cylinder: ["[(", ")]"],
};

const ARROW: Record<(typeof diagramEdgeStyles)[number], string> = {
  solid: "-->",
  dashed: "-.->",
  thick: "==>",
};

// Prefixed so no spec id can be a mermaid keyword (`end`, `style`, `class`, `subgraph`, …).
const nodeRef = (id: string) => `n_${id}`;
const groupRef = (id: string) => `g_${id}`;

/** One validated spec as flowchart mermaid. Pure; the title is the caller's, not the source's. */
export function toMermaid(input: DiagramSpecInput): string {
  const spec: DiagramSpec = diagramSpecSchema.parse(input);
  const grouped = new Set((spec.groups ?? []).flatMap((group) => group.nodes));
  const declare = (node: DiagramSpec["nodes"][number], indent: string) => {
    const [open, close] = SHAPE[node.shape];
    return `${indent}${nodeRef(node.id)}${open}${mermaidLabel(node.label)}${close}`;
  };
  const byId = new Map(spec.nodes.map((node) => [node.id, node]));
  const lines = [`flowchart ${spec.direction}`];
  for (const node of spec.nodes) if (!grouped.has(node.id)) lines.push(declare(node, "  "));
  for (const group of spec.groups ?? []) {
    lines.push(`  subgraph ${groupRef(group.id)} [${mermaidLabel(group.label)}]`);
    for (const id of group.nodes) lines.push(declare(byId.get(id)!, "    "));
    lines.push("  end");
  }
  for (const edge of spec.edges) {
    const label = edge.label?.trim() ? `|${mermaidLabel(edge.label)}|` : "";
    lines.push(`  ${nodeRef(edge.from)} ${ARROW[edge.style]}${label} ${nodeRef(edge.to)}`);
  }
  return lines.join("\n");
}

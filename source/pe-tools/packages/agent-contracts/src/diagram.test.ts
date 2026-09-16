import { parseMermaid } from "beautiful-mermaid";
import { describe, expect, test } from "vite-plus/test";
import { diagramSpecSchema, toMermaid, type DiagramSpecInput } from "./diagram.ts";

/** The seed's duct system: AHU, two mains, four branches, VAV terminals, one group per main. */
const DUCT_SPEC: DiagramSpecInput = {
  title: "AHU-1 supply air",
  direction: "LR",
  nodes: [
    { id: "AHU1", label: "AHU-1\n8000 cfm", shape: "stadium" },
    { id: "M1", label: "Main A" },
    { id: "M2", label: "Main B" },
    { id: "B1", label: "Branch A1" },
    { id: "B2", label: "Branch A2" },
    { id: "B3", label: "Branch B1" },
    { id: "B4", label: "Branch B2" },
    { id: "V1", label: "VAV A1-1", shape: "round" },
    { id: "V2", label: "VAV A2-1", shape: "round" },
    { id: "V3", label: "VAV B1-1", shape: "round" },
    { id: "V4", label: "VAV B2-1", shape: "round" },
  ],
  edges: [
    { from: "AHU1", to: "M1", label: "4800 cfm", style: "thick" },
    { from: "AHU1", to: "M2", label: "3200 cfm", style: "thick" },
    { from: "M1", to: "B1", label: "2400 cfm" },
    { from: "M1", to: "B2", label: "2400 cfm" },
    { from: "M2", to: "B3", label: "1600 cfm" },
    { from: "M2", to: "B4", label: "1600 cfm", style: "dashed" },
    { from: "B1", to: "V1", label: "2400 cfm" },
    { from: "B2", to: "V2", label: "2400 cfm" },
    { from: "B3", to: "V3", label: "1600 cfm" },
    { from: "B4", to: "V4", label: "1600 cfm" },
  ],
  groups: [
    { id: "mainA", label: "Main A", nodes: ["M1", "B1", "B2", "V1", "V2"] },
    { id: "mainB", label: "Main B", nodes: ["M2", "B3", "B4", "V3", "V4"] },
  ],
};

const issues = (input: unknown) =>
  (diagramSpecSchema.safeParse(input).error?.issues ?? []).map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );

describe("diagram spec schema", () => {
  test("the duct system passes", () => {
    expect(issues(DUCT_SPEC)).toEqual([]);
  });

  test("every cross-field rule rejects at its exact path, all at once", () => {
    const bad = {
      nodes: [
        { id: "AHU", label: "AHU" },
        { id: "AHU", label: "again" },
        { id: "VAV1", label: "VAV" },
      ],
      edges: [
        { from: "AHU", to: "VAV1" },
        { from: "AHU", to: "VAV-9" },
        { from: "ghost", to: "AHU" },
      ],
      groups: [
        { id: "g1", label: "one", nodes: ["AHU", "nope"] },
        { id: "g1", label: "dup", nodes: ["AHU"] },
        { id: "VAV1", label: "clash", nodes: [] },
      ],
    };
    expect(issues(bad)).toEqual([
      'nodes.1.id: duplicate id "AHU"',
      'edges.1.to: no node "VAV-9"',
      'edges.2.from: no node "ghost"',
      'groups.0.nodes.1: no node "nope"',
      'groups.1.id: duplicate group id "g1"',
      'groups.1.nodes.0: node "AHU" is already in group "g1"',
      'groups.2.id: "VAV1" is already a node id',
    ]);
  });

  test("shape limits reject at their paths alongside the cross-field rules", () => {
    const bad = {
      title: "x".repeat(81),
      nodes: [
        { id: "9lives", label: "" },
        { id: "A", label: "x".repeat(81), shape: "hexagon" },
      ],
      edges: [{ from: "A", to: "B", label: "y".repeat(61) }],
    };
    expect(issues(bad)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^title: /),
        expect.stringMatching(/^nodes\.0\.id: must start with a letter/),
        expect.stringMatching(/^nodes\.0\.label: /),
        expect.stringMatching(/^nodes\.1\.label: /),
        expect.stringMatching(/^nodes\.1\.shape: /),
        expect.stringMatching(/^edges\.0\.label: /),
      ]),
    );
    expect(issues({ nodes: [], edges: [] })).toEqual([expect.stringMatching(/^nodes: /)]);
  });
});

const HOSTILE = [
  'close"] quote',
  "brackets ] [ ) ( } { )) ]]",
  "pipe | in | label",
  "arrow --> B and ==> C and -.-> D",
  "line one\nline two\r\nline three",
  "%% not a comment",
  '<script>alert(1)</script><img src=x onerror="y">',
  "&#93; entity &amp; &lt;b&gt;",
  "end",
  "subgraph X",
  "**bold** ~~strike~~ *em* `tick`",
  "back\\slash \\n escape; semi # hash",
];

describe("toMermaid", () => {
  const cases: [string, DiagramSpecInput][] = [
    ["duct system", DUCT_SPEC],
    [
      "hostile labels on every surface",
      {
        nodes: HOSTILE.map((label, index) => ({
          id: index === 0 ? "end" : `n${index}`,
          label,
          shape: (["box", "round", "stadium", "circle", "diamond", "cylinder"] as const)[index % 6],
        })),
        edges: HOSTILE.slice(1).map((label, index) => ({
          from: index === 0 ? "end" : `n${index}`,
          to: `n${index + 1}`,
          label: label.slice(0, 60),
          style: (["solid", "dashed", "thick"] as const)[index % 3],
        })),
        groups: [{ id: "style", label: HOSTILE[0]!, nodes: ["n1", "n2"] }],
      },
    ],
    ["one node, no edges", { nodes: [{ id: "A", label: "alone" }], edges: [] }],
  ];

  test.each(cases)("%s: beautiful-mermaid parses exactly the spec's nodes and edges", (_, spec) => {
    const graph = parseMermaid(toMermaid(spec));
    expect(graph.nodes.size).toBe(spec.nodes.length);
    expect(graph.edges.length).toBe(spec.edges.length);
    expect(graph.subgraphs.length).toBe(spec.groups?.length ?? 0);
  });

  test("hostile labels arrive as text, never as syntax", () => {
    const source = toMermaid(cases[1]![1]);
    const graph = parseMermaid(source);
    const labels = [...graph.nodes.values()].map((node) => node.label);
    expect(labels).toHaveLength(HOSTILE.length);
    for (const label of labels) {
      expect(label).not.toMatch(/[<>"[\](){}|]/);
      expect(label).not.toContain("&#");
    }
    // The script tag's words survive as inert text.
    expect(labels.some((label) => label.includes("script") && label.includes("alert"))).toBe(true);
    // No emitted line is a comment, a bare `end`, or a style directive from a label.
    const body = source
      .split("\n")
      .slice(1)
      .map((line) => line.trim());
    expect(body.filter((line) => line.startsWith("%%"))).toEqual([]);
    expect(body.filter((line) => line === "end")).toHaveLength(1);
    expect(body.filter((line) => /^(style|classDef|class|linkStyle)\s/.test(line))).toEqual([]);
    // A newline is a line break inside its node, not a new statement.
    expect(labels.some((label) => label === "line one\nline two\nline three")).toBe(true);
  });

  test("the duct system reads as mermaid a person can paste", () => {
    expect(toMermaid(DUCT_SPEC).split("\n").slice(0, 3)).toEqual([
      "flowchart LR",
      '  n_AHU1(["AHU-1<br>8000 cfm"])',
      '  subgraph g_mainA ["Main A"]',
    ]);
    expect(toMermaid(DUCT_SPEC)).toContain('  n_AHU1 ==>|"4800 cfm"| n_M1');
    expect(toMermaid(DUCT_SPEC)).toContain('  n_M2 -.->|"1600 cfm"| n_B4');
  });
});

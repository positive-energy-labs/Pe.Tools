import { describe, expect, it } from "vite-plus/test";
import baseline from "./unification-2.baseline.json" with { type: "json" };
import { arraySchema, census, declarationLines, selectionSlots, syntax } from "./unification-2-census.ts";
import { root } from "./unification-2-census.ts";
import { execFileSync } from "node:child_process";

const baselinePath = "ts/tests/repo-guards/src/unification-2.baseline.json";
// Compare all committed ceilings, so raising a ceiling in the same commit cannot reset debt.
const history = execFileSync("git", ["log", "--format=%H", "--", baselinePath], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .map(
    (sha) =>
      JSON.parse(
        execFileSync("git", ["show", `${sha}:${baselinePath}`], { cwd: root, encoding: "utf8" }),
      ) as Record<string, number>,
  );

describe("unification 2 ratchets (ADR 0026 D7, ADR 0027/0028)", () => {
  const actual = census();
  it("keeps a baseline for every law", () => {
    expect(Object.keys(baseline).sort()).toEqual(Object.keys(actual).sort());
  });
  for (const [law, cap] of Object.entries(baseline))
    it(`${law} <= ${cap}`, () => {
      const offenders = actual[law]!;
      expect(cap, `${law}: baseline must never grow`).toBeLessThanOrEqual(
        Math.min(...history.map((b) => b[law] ?? Infinity)),
      );
      console.log(`${law}: ${offenders.length}/${cap}`);
      expect(offenders.length, `${law} offenders:\n${offenders.join("\n")}`).toBeLessThanOrEqual(
        cap,
      );
    });
});

it("selection detector ignores booleans, DOM refs and presentation state", () => {
  expect(
    selectionSlots(
      syntax(
        `const [selectedIds] = useState<string[]>([]); const selected = useRef<Set<string>>(new Set()); const [selected] = useState(false); const [open] = useState('x'); const selected = useRef<HTMLDivElement>(null);`,
      ),
    ),
  ).toHaveLength(2);
});
it("declaration LOC separates multiline bodies from manifest structure", () => {
  const count = (body: string) =>
    declarationLines(
      syntax(
        `import {x} from 'x';\nconst graph = {\n run: () => {\n${body}\n },\n key: 'route',\n};`,
      ),
    ).length;
  expect(count("return 1;")).toBe(count("const x = 2;\nreturn x;"));
  expect(count("return 1;")).toBeGreaterThan(0);
});

it("every graph keeps its behavior declaration within 60 lines", () => {
  const counts = new Map<string, number>();
  for (const site of census().graphDeclarations!) {
    const file = site.slice(0, site.lastIndexOf(":"));
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  expect([...counts].filter(([, count]) => count > 60).map(([p, n]) => `${p}: declaration ${n} > 60`)).toEqual([]);
});
it("declarations include template tails and graph factories, excluding metadata", () => {
  const body = `({\nkey: "r",\ndirectory: {title: "metadata"},\nseeds: {},\nfields: {},\nreadings: {},\nverbs: {label: \`hello \${name}\`},\npanes: {},\nstages: {x: {}}\n})`;
  const plain = declarationLines(syntax(`const graph = ${body};`));
  expect(plain).toEqual([5,6,7,8,9]);
  expect(declarationLines(syntax(`const graph = () => ${body};`))).toEqual(plain);
  expect(declarationLines(syntax(`const graph = {\n key: "r",\n directory: {\n title: "metadata",\n },\n fields: {},\n readings: {},\n verbs: {},\n panes: {},\n stages: {},\n};`))).toEqual([6,7,8,9,10]);
});

it("array ratchet distinguishes named state from a wrapped array Page value", () => {
  const value = (text: string) => (syntax(text).statements[0] as import("typescript").ExpressionStatement).expression;
  expect(arraySchema(value("z.array(z.string()).readonly().default([])"))).toBe(true);
  expect(arraySchema(value("z.object({ columns: z.array(z.string()) }).default({ columns: [] })"))).toBe(false);
});

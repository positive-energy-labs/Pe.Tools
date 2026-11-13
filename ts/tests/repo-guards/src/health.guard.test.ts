import { describe, expect, it } from "vite-plus/test";
import baseline from "./health.baseline.json" with { type: "json" };
import {
  census, escapeCounts, EXCEPTIONS, exceptionProblems, fsWriteCount, isProduction, NAMES, PER_FILE, perFileRises, rises,
  STORE_EXCEPTION, storeScopeSources, total,
} from "./health-census.ts";

// Each count only falls: remove the cast, suppression or mark, or split the file, then
// `vp run ratchets:tighten`. A total may not rise; code may move between files.
describe("production health counts", () => {
  const actual = census();
  for (const name of NAMES)
    it(`${name} do not rise above the baseline`, () => {
      const [now, was] = [total(actual[name]), total(baseline[name])];
      expect(
        now <= was ? [] : rises(actual[name], baseline[name]),
        `${name}: ${now}; the baseline is ${was}`,
      ).toEqual([]);
    });

  for (const name of PER_FILE)
    it(`${name} rise in no file, and a new file starts at 0`, () => {
      expect(perFileRises(name, actual[name], baseline[name]), `${name} hold per file; only a named owner (OWNERS) may absorb writes`).toEqual([]);
    });

  it("counts every cast and `any`, and every non-null `!`, from the syntax tree; `as const` is no cast", () => {
    const sample = `
      const a = x as Foo; const b = y as unknown as Bar; const c = <Baz>z; const d = [1] as const;
      function f(p: any): Promise<any> { return p; }
      const name = "as any"; // as Foo in a comment
      const e = q!; const g = r satisfies S;`;
    expect(escapeCounts("ts/apps/host/src/planted.ts", sample)).toEqual({ casts: 6, nonNull: 1 });
    expect(escapeCounts("ts/apps/web/src/planted.tsx", "const v = <div>{x! as Y}</div>; a !== b;")).toEqual({ casts: 1, nonNull: 1 });
  });

  it("each written store exception stands at its site with its end condition", () => {
    expect(exceptionProblems(storeScopeSources())).toEqual([]);
  });

  it("an exception whose marker is removed, or a marker nobody listed, is red", () => {
    const [listed, end] = Object.entries(EXCEPTIONS)[0]!;
    const sources = Object.fromEntries(Object.entries(EXCEPTIONS).map(([file, e]) => [file, `// ${STORE_EXCEPTION}; ends when ${e} replaces this.`]));
    expect(exceptionProblems(sources)).toEqual([]);
    expect(exceptionProblems({ ...sources, [listed]: "// a plain comment" })).toEqual([
      `${listed}: the written exception is gone; the site needs "${STORE_EXCEPTION}" and its end condition (${end})`,
    ]);
    // A wrapped comment carries its end condition; code after the comment does not.
    expect(exceptionProblems({ ...sources, [listed]: `// ${STORE_EXCEPTION}; kept\n// until ${end} replaces it.\nx;` })).toEqual([]);
    expect(exceptionProblems({ ...sources, [listed]: `x;\n// ${STORE_EXCEPTION}; kept for now.\nconst ${end} = 1;` })).toEqual([
      `${listed}:2: ${STORE_EXCEPTION} names no end condition (${end})`,
    ]);
    expect(exceptionProblems({ ...sources, "ts/apps/host/src/x.ts": `// ${STORE_EXCEPTION}` })).toEqual([
      `ts/apps/host/src/x.ts: carries ${STORE_EXCEPTION} but is not in EXCEPTIONS (health-census.ts)`,
    ]);
  });

  it("lets a named owner absorb writes and holds every other file", () => {
    expect(perFileRises("fsWrites", { "ts/packages/host-contracts/src/store.ts": 9, "ts/apps/host/src/x.ts": 1 }, { "ts/packages/host-contracts/src/store.ts": 4 }))
      .toEqual(["ts/apps/host/src/x.ts: 0 -> 1"]);
  });

  it("counts every filesystem mutation spelling and nothing that only reads", () => {
    const sample = `
      import { writeFileSync, rename as move, readFileSync } from "node:fs";
      import * as fsp from "node:fs/promises";
      import { promises } from "fs";
      import { mkdir } from "fs/promises";
      writeFileSync("a", "b"); move("a", "b"); readFileSync("a");
      fsp.appendFile("a", "b"); fsp.readFile("a"); promises.rm("a"); mkdir("d");
      const program = Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString("a", "b"); yield* fs.readFileString("a");
        yield* fs.makeDirectory("d").pipe(Effect.orDie);
      });
      const other = { rm() {} }; other.rm(); rename("x");`;
    expect(fsWriteCount("ts/apps/host/src/planted.ts", sample)).toBe(7);
  });

  it("names the file whose count rose, and reads production files only", () => {
    expect(rises({ "a.ts": 2, "new.cs": 1 }, { "a.ts": 1, "b.ts": 3 })).toEqual([
      "a.ts: 1 -> 2",
      "new.cs: 0 -> 1",
    ]);
    expect(
      [
        "a/b.ts",
        "a/b.test.ts",
        "a/tests/b.ts",
        "X.Tests/B.cs",
        "a/generated/b.ts",
        "b.d.ts",
      ].filter(isProduction),
    ).toEqual(["a/b.ts"]);
  });
});

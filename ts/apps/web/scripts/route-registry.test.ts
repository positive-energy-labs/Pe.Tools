import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { projectWork } from "./host-projection.ts";
import { renderRouteRegistry } from "./route-registry.ts";

test("one row per builtin: static closure and host read imports, the work projection aliased", () => {
  const text = renderRouteRegistry([
    { key: "fans", folder: "fans", host: "./host.ts",
      work: { name: "hydronicWork", definition: 'import { hydronicWorkSchema as hydronicWorkSchema } from "../../web/src/fans/work.ts";\nconst hydronicWork={route:"fans",schema:hydronicWorkSchema,schemaVersion:1};\n',
        properties: "workState: work, readWorks: [], schemas: {}," } },
    { key: "chat", folder: "chat", host: "./host.ts" },
    { key: "home", folder: "home" },
  ]);
  expect(text).toContain(`import * as h0 from "../../web/src/fans/host.ts";`);
  expect(text).toContain(`import c2 from "../../web/src/home/source-closure.generated.json" with { type: "json" };`);
  // The Work binds from the route directory; the binding precedes every row that reads it.
  expect(text).toContain(`import { hydronicWorkSchema as hydronicWorkSchema } from "../../web/src/fans/work.ts";`);
  expect(text.indexOf("const hydronicWork=")).toBeLessThan(text.indexOf("export const routeRegistry"));
  expect(text).toContain(`...((data = r0.envelope.data, work = hydronicWork) => ({ data, workState: work, readWorks: [], schemas: {}, }))(), reads: h0.reads`);
  expect(text).toContain(`"chat": { key: "chat", closure: r1, host: { data: r1.envelope.data, schemas: {}, reads: h1.reads } }`);
  expect(text).toContain(`"home": { key: "home", closure: r2, host: { data: r2.envelope.data, schemas: {} } }`);
  expect(text.match(/^import /gm)).toHaveLength(3 + 3 + 2 + 1);
});

test("a host read outside the route directory is refused; a duplicate key is refused", () => {
  const row = { key: "fans", folder: "fans" };
  expect(() => renderRouteRegistry([{ ...row, host: "../../../host/src/reads/fans.ts" }])).toThrow(
    "fans: a host read lives in its route directory",
  );
  expect(() => renderRouteRegistry([row, row])).toThrow("Duplicate route key fans");
});

test("a Work declared in route.ts is refused, with or without the extension", async () => {
  const folder = mkdtempSync(join(tmpdir(), "project-work-"));
  try {
    for (const specifier of ["./route", "./route.ts"]) {
      const entry = join(folder, "entry.ts");
      writeFileSync(entry, `import { fansWork } from ${JSON.stringify(specifier)};
export const module = route({ edits: { work: fansWork } });
`);
      // The refusal precedes every read of the typed route and of the Work module.
      await expect(projectWork(entry, undefined as never, join(folder, "routes.generated.ts"), "fansWork", async () => ({}), false))
        .rejects.toThrow("declare Work in a neutral module beside route.ts");
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

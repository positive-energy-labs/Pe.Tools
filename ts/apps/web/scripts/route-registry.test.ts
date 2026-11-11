import { expect, test } from "vite-plus/test";
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

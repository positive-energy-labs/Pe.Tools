import { expect, test } from "vite-plus/test";
import { renderRouteRegistry } from "./route-registry.ts";

test("one row per builtin: static closure and host read imports, the work projection aliased", () => {
  const text = renderRouteRegistry([
    { key: "fans", folder: "fans", address: "/fans", contract: "fans", dock: false, host: "./host.ts",
      work: { stateExport: "fansRouteState", file: "../../../packages/agent-contracts/src/generated/fans-work.ts",
        properties: "workState: work, readWorks: [], schemas: {}," } },
    { key: "chat", folder: "chat", address: "/pea", contract: "pea", dock: true, host: "./host.ts" },
    { key: "home", folder: "home", address: "/", contract: "home", dock: false },
  ]);
  expect(text).toContain(`import * as h0 from "../../web/src/fans/host.ts";`);
  expect(text).toContain(`import c2 from "../../web/src/home/source-closure.generated.json" with { type: "json" };`);
  expect(text).toContain(`import { fansRouteState as w0 } from "../../../packages/agent-contracts/src/generated/fans-work.ts";`);
  expect(text).toContain(`...((data = r0.envelope.data, work = w0) => ({ data, workState: work, readWorks: [], schemas: {}, }))(), reads: h0.reads`);
  expect(text).toContain(`"chat": { key: "chat", folder: "chat", address: "/pea", contract: "pea", dock: true, closure: r1, host: { data: r1.envelope.data, schemas: {}, reads: h1.reads } }`);
  expect(text).toContain(`"home": { key: "home", folder: "home", address: "/", contract: "home", dock: false, closure: r2, host: { data: r2.envelope.data, schemas: {} } }`);
  expect(text.match(/^import /gm)).toHaveLength(3 + 3 + 2 + 1);
});

test("a host read outside the route directory is refused; a duplicate key is refused", () => {
  const row = { key: "fans", folder: "fans", address: "/fans", contract: "fans", dock: false };
  expect(() => renderRouteRegistry([{ ...row, host: "../../../host/src/reads/fans.ts" }])).toThrow(
    "fans: a host read lives in its route directory",
  );
  expect(() => renderRouteRegistry([row, row])).toThrow("Duplicate route key fans");
});

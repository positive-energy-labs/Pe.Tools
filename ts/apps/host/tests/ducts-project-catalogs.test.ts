import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { DuctFiles, ductCatalogsRoute } from "../src/ducts-files.ts";
import { nativeFixture } from "./fans-work-fixture.ts";
import { snapshot } from "../../web/src/ducts/test-fixture.ts";
import { catalogLinkKey } from "@pe/ducts-domain/catalog";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/contracts";
import { settle } from "./effect-test.ts";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });

test("losses plan and sheet catalog read price from the target project home", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-loss-catalogs-"));
  closes.push(() => rm(root, { recursive: true, force: true }));
  const firm = join(root, "04 PE Software Files", "Pe.Tools"), project = join(root, "Projects", "Example", "Pe.Tools"), user = join(root, "user");
  for (const [home, tier] of [[firm, "firm"], [project, "project"], [user, "user"]]) {
    await mkdir(home!, { recursive: true });
    await writeFile(join(home!, "pe-home.json"), JSON.stringify({ tier }));
  }
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", user);
  const axis = { quantity: "flow", unit: "cfm", values: [0, 1000], input: { field: "flowCfm" } };
  for (const [home, id, value] of [[user, "host-table", 0.1], [project, "project-table", 0.73]] as const) {
    const folder = join(home, "Catalogs", id);
    await mkdir(folder, { recursive: true }); await writeFile(join(folder, "fixture.pdf"), "%PDF-fixture");
    await writeFile(join(folder, "catalog.json"), JSON.stringify({ version: 1, tables: [{ id, title: id,
      source: { file: "fixture.pdf", title: "Fixture", edition: "1", url: "https://example.com", page: 1, pdfPage: 1 },
      rows: axis, columns: axis, cells: { quantity: "pressure", unit: "in-wg", values: [[value, value], [value, value]] },
      result: { from: "cells", quantity: "static-pressure", unit: "in-wg", toInWg: 1, velocityBasis: "connector", note: "fixture" },
    }] }));
  }
  const scope = Scope.makeUnsafe(); closes.push(() => settle(Scope.close(scope, Exit.void)));
  const files = Context.get(await settle(Layer.buildWithScope(DuctFiles.layer(), scope)), DuctFiles);
  const captured = structuredClone(snapshot), terminal = captured.nodes.find(n => n.id === 4)!;
  terminal.family = "Catalog terminal"; terminal.type = "Fixture";
  terminal.connectors[0]!.diameterIn = 8;
  terminal.facts.push({ key: "Pe_Catalog", text: "project-table", value: null, unit: "", provenance: "revit-reported" });
  const f = await nativeFixture("real", () => captured, null, { deps: { files }, routes: ductCatalogsRoute.pipe(Layer.provide(DuctFiles.layer())), state: { openDocuments: [{
    openId: "selected-open", title: "Catalog fixture", isActive: true, isFamilyDocument: false, address: null, projectHome: "Projects/Example",
  }] } });
  closes.push(() => f.close());
  const subject = elementSubject(terminal);
  const fanKey = { ...f.key, route: "fans" };
  // The fans write is the only losses plan: the scope is the fan's walk, staged in Fans Work.
  const fans = await f.saved.apply(fanKey, "fans", "human", [
    { path: ["flows", subject, "edit"], value: { value: 250 } },
    { path: ["writeIntent", "edit"], value: { value: { walk: { unitId: 100, portIndex: 0 } } } },
  ], 0);
  expect(fans).toMatchObject({ ok: true });
  expect(await f.saved.apply(f.key, "ducts", "human", [{ path: ["catalogs", catalogLinkKey(terminal.family, terminal.type), "edit"], value: { value: { table: "project-table" } } }], 0)).toMatchObject({ ok: true });
  const response = await f.post("/actions", { id: "project-loss", key: "sheet.plan", target: f.target,
    input: { work: { key: fanKey, revision: fans.ok ? fans.revision : -1 } } });
  expect(response.status, await response.clone().text()).toBeLessThan(400);
  const receipt = await f.journal.wait("project-loss");
  expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded", result: { derivedRequest: { terminals: [expect.objectContaining({ id: 4 })] } } });
  const planned = (receipt as { result: { derivedRequest: { terminals: { id: number; inWg: number }[] } } }).result.derivedRequest.terminals.find(t => t.id === 4)!;
  expect(planned.inWg).toBeCloseTo(0.7619678404550739);
  const headers = { [HOST_RPC_BRIDGE_SESSION_HEADER]: f.target.ref.session, [HOST_RPC_DOCUMENT_HEADER]: f.target.ref.openId };
  const catalogs = await (await f.request(new Request("http://fixture/pe/ducts/catalogs", { headers }))).json();
  expect(catalogs.tables["project-table"].cells.values[0][0]).toBe(0.73);
});

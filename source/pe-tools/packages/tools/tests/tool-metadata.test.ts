import { expect, test } from "vite-plus/test";
import { peCodeToolCatalog, peCodeTools } from "../src/dev/index.ts";
import { peaProductToolCatalog, peaProductTools } from "../src/pea/index.ts";

test("Pea product catalog covers exported product tools", () => {
  expect([...peaProductToolCatalog.keys()].sort()).toEqual(Object.keys(peaProductTools).sort());
  expect(peaProductToolCatalog.get("host_operation_call")).toMatchObject({
    kind: "read",
    title: "Host Operation Call",
  });
});

test("pe-code catalog covers exported dev tools", () => {
  expect([...peCodeToolCatalog.keys()].sort()).toEqual(Object.keys(peCodeTools).sort());
  expect(peCodeToolCatalog.get("live_rrd_sync")).toMatchObject({
    kind: "edit",
    title: "Live Rrd Sync",
  });
  expect(peCodeToolCatalog.get("script_execute")).toMatchObject({ kind: "execute" });
});

import { expect, test } from "vite-plus/test";
import { peCodeRuntimeToolProfile, peCodeToolCatalog, peCodeTools } from "../src/dev/index.ts";
import { peaProductToolCatalog, peaProductToolProfile, peaProductTools } from "../src/pea/index.ts";

const defaultPeCodeToolIds = [
  ...new Set([...Object.keys(peaProductTools), ...Object.keys(peCodeTools)]),
].sort();

test("Pea product profile covers exported product tools and commands", () => {
  expect([...peaProductToolCatalog.keys()].sort()).toEqual(Object.keys(peaProductTools).sort());
  expect(peaProductToolProfile.tools).toBe(peaProductTools);
  expect(peaProductToolProfile.catalog).toBe(peaProductToolCatalog);
  expect(Object.keys(peaProductToolProfile.commands?.createSubCommands?.() ?? {})).toEqual(
    expect.arrayContaining(["host", "script"]),
  );
  expect(peaProductToolCatalog.get("host_operation_call")).toMatchObject({
    kind: "read",
    title: "Host Operation Call",
  });
});

test("peco catalog covers exported dev tools", () => {
  expect([...peCodeToolCatalog.keys()].sort()).toEqual(Object.keys(peCodeTools).sort());
  expect(peCodeToolCatalog.get("live_rrd_sync")).toMatchObject({
    kind: "edit",
    title: "Live Rrd Sync",
  });
  expect(peCodeToolCatalog.get("script_execute")).toMatchObject({
    kind: "execute",
  });
});

test("peco runtime profile composes product and dev tools", () => {
  expect(Object.keys(peCodeRuntimeToolProfile.tools).sort()).toEqual(defaultPeCodeToolIds);
  expect([...peCodeRuntimeToolProfile.catalog.keys()].sort()).toEqual(defaultPeCodeToolIds);
  expect(Object.keys(peCodeRuntimeToolProfile.commands?.createSubCommands?.() ?? {})).toEqual(
    expect.arrayContaining(["live", "script", "talk-to-pea", "talk-to-peco-zellij"]),
  );
});

import { afterEach, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({ suffix: "" }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      const source = fs.readFileSync(...args);
      return String(args[0]).endsWith("pe.js") ? source + fixture.suffix : source;
    },
  };
});

import { createPagesHandler } from "../src/pages-route.ts";

afterEach(() => {
  fixture.suffix = "";
});

it("refuses a newly introduced unfilled client slot instead of serving broken JavaScript", async () => {
  fixture.suffix = "\nconst futureClient = /*pe:future-client*/ null;";
  const handle = createPagesHandler("unused-pages", "unused-pods");
  await expect(handle(new Request("http://host/pages/pe.js"))).rejects.toThrow(
    "Unfilled pe.js slot: /*pe:future-client*/ null",
  );
});

it("fills every slot in the shipped Page client", async () => {
  const handle = createPagesHandler("unused-pages", "unused-pods");
  const response = await handle(new Request("http://host/pages/pe.js"));
  expect(response.status).toBe(200);
  expect(await response.text()).not.toMatch(/\/\*pe:[^*]+\*\/\s*null\b/);
});

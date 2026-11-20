import { expect, test, vi } from "vite-plus/test";
import { createCapabilityCatalogSource } from "../src/pea/capabilities.ts";

const content = (sourceDiagnostics?: { packages: string[]; skills: string[] }) => async () => ({
  packages: [],
  skills: [],
  diagnostics: [],
  ...(sourceDiagnostics ? { sourceDiagnostics } : {}),
});
const read = async (sourceDiagnostics?: { packages: string[]; skills: string[] }) => {
  vi.stubGlobal("fetch", async () => Response.json({ operations: [] }));
  try {
    const source = createCapabilityCatalogSource({
      hostBaseUrl: "http://fixture",
      registrations: [],
      machine: async () =>
        ({ legs: {}, revit: { sessions: [], unclassifiedAttachments: [] } }) as never,
      content: content(sourceDiagnostics),
    });
    return (await source.read({})).sources;
  } finally {
    vi.unstubAllGlobals();
  }
};

test("a Pod problem answers for packages and never for skills", async () => {
  const sources = await read({
    packages: ["default/src/Missing.cs: Entrypoint has no admitted source file."],
    skills: [],
  });
  expect(sources.packages).toBe("default/src/Missing.cs: Entrypoint has no admitted source file.");
  expect(sources.skills).toBe("ok");
});

test("a skill publication notice answers for skills and never for packages", async () => {
  const sources = await read({ packages: [], skills: ["skill pea/x: not published"] });
  expect(sources.skills).toBe("skill pea/x: not published");
  expect(sources.packages).toBe("ok");
});

test("no diagnostics read ok on both", async () => {
  const sources = await read();
  expect([sources.packages, sources.skills]).toEqual(["ok", "ok"]);
});

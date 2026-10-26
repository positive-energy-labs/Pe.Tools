import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserSkillName, renderBrowserGuide } from "@pe/browser/guide";
import type { CapabilityCatalog } from "@pe/agent-contracts";
import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { captureDirectory } from "../../../apps/host/src/packages.ts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { peFind, peRead } from "../src/pea/capability-tools.ts";
import { publishPeaSkills, resolvePeaSkillPaths } from "../src/pea/skills.ts";
import { fakeRuntimeHost } from "./runtime-host-fixture.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("the browser guide is published to both harnesses and discovered/read from its admitted revision", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "");
  const home = await mkdtemp(join(tmpdir(), "pe-browser-skill-"));
  try {
    const publication = await publishPeaSkills({ productHomePath: home, captureDirectory });
    const key = `skill:@product/skills/${browserSkillName}`;
    const admitted = publication.skills.filter((skill) => skill.key === key);
    expect(admitted).toHaveLength(1);
    const skill = admitted[0]!;
    const expected = `${renderBrowserGuide("pea browser").trimEnd()}\n`;
    expect(skill.content).toBe(expected);
    const sha256 = createHash("sha256").update(expected).digest("hex");
    expect(skill.package).toEqual({
      id: "product",
      path: `skills/${browserSkillName}/SKILL.md`,
      sha256,
    });
    for (const root of resolvePeaSkillPaths({ productHomePath: home }))
      expect(await readFile(join(root, browserSkillName, "SKILL.md"), "utf8")).toBe(expected);

    const catalog: CapabilityCatalog = {
      at: new Date().toISOString(),
      machine: machineFixture([]),
      sources: { skills: "ok" },
      diagnostics: [],
      capabilities: buildCapabilities({
        ops: [],
        routes: [],
        packages: [],
        skills: publication.skills,
      }),
    };
    const reads: URL[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/pe/capabilities") return Response.json(catalog);
      if (url.pathname === "/pe/contributions") {
        reads.push(url);
        const source = publication.skills.find(
          (entry) => entry.key === url.searchParams.get("key"),
        );
        if (!source || source.package.sha256 !== url.searchParams.get("sha256"))
          return Response.json({ error: "Admitted revision unavailable" }, { status: 404 });
        return Response.json({
          content: source.content,
          bytesBase64: Buffer.from(source.files[0]!.bytes).toString("base64"),
          sha256: source.package.sha256,
        });
      }
      throw Error(`Unexpected browser skill request ${url.pathname}`);
    });
    const found = (await peFind.execute!(
      { query: "browser", kind: "skill", limit: 8 } as never,
      {} as never,
    )) as { matches: { key: string; needs: string; mutates: boolean; package: unknown }[] };
    expect(found.matches.find((row) => row.key === key)).toMatchObject({
      needs: "nothing",
      mutates: false,
      package: skill.package,
    });
    const read = await peRead.execute!({ key, timeoutSeconds: 30 } as never, {} as never);
    expect(read).toMatchObject({
      ok: true,
      result: expected,
      source: skill.package,
      bytesBase64: Buffer.from(expected).toString("base64"),
    });
    expect(reads).toHaveLength(1);
    expect(reads[0]!.searchParams.get("key")).toBe(key);
    expect(reads[0]!.searchParams.get("sha256")).toBe(sha256);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

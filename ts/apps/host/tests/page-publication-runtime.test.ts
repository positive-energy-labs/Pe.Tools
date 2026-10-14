import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";

it("loads the Page publisher through the real Node/Jiti source loader", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-page-loader-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "jiti/register",
        "--input-type=module",
        "--eval",
        "await import('./src/ensure-source-lane.ts'); const page = await import('./src/page-publication.ts'); const publish = page.default?.publishPage ?? page.publishPage; const result = await publish(process.env.PE_TOOLS_PRODUCT_HOME, {kind:'page',slug:'native',title:'Native',html:'<!doctype html><title>Native</title><p>Native loader</p>'}, 'http://fixture', async()=>new Response(null,{status:404})); if (!result.capture.data.startsWith('iVBOR')) throw Error('PNG missing'); console.log('Page publisher imported and captured');",
      ],
      {
        cwd: join(import.meta.dirname, ".."),
        env: { ...process.env, PE_TOOLS_PRODUCT_HOME: home },
        encoding: "utf8",
        timeout: 40_000,
      },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Page publisher imported");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 45000);

import { afterEach, expect, test, vi } from "vite-plus/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homesConfigPath } from "@pe/host-contracts/product-paths";
import { contentHomes, homesStatus, writeHomesConfig } from "../src/content-roots.ts";
import { hostOwnership, hostState } from "../src/host-ownership.ts";
import { createPeRoutes } from "../src/pe-routes.ts";

afterEach(() => vi.unstubAllEnvs());

// Settings' write door for `state\homes.json`. Mutant, run red once (2026-11-17): skip
// `reresolveContentRoots` in `writeHomesConfig` and the first `contentHomes` read stays firm-less.
test("a homes write lands in state homes.json, re-resolves before answering, and refuses a relative path or a home holding the state", async () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", undefined);
  const file = hostState().homesConfig;
  expect(homesConfigPath()).toBe(file);
  const firm = join(
    mkdtempSync(join(tmpdir(), "pe-chosen-drive-")),
    "04 PE Software Files",
    "Pe.Tools",
  );
  try {
    const unmarked = await writeHomesConfig({ firm });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ firm });
    expect(unmarked.homes.map((home) => home.tier)).toEqual(["user"]);
    expect(unmarked.firmNotice).toBe("Set your firm home in Settings");

    mkdirSync(firm, { recursive: true });
    const marked = await writeHomesConfig({ firm });
    expect(contentHomes().find((home) => home.tier === "firm")?.root).toBe(firm);
    expect(marked.homes.find((home) => home.tier === "firm")).toEqual({
      tier: "firm",
      path: firm,
      found: "config",
    });
    // The test run's isolated user home is the environment override, and it beats a chosen user home.
    expect(marked.homes.find((home) => home.tier === "user")?.found).toBe("override");
    expect(homesStatus()).toEqual(marked);

    await expect(writeHomesConfig({ firm: "relative\\Pe.Tools" })).rejects.toThrow("absolute path");
    await expect(writeHomesConfig({ user: hostOwnership.rootPath })).rejects.toThrow(
      "holds this machine's state",
    );
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ firm });

    // The declared doors: GET answers the status, a refused PUT is a 400 whose message the web client reads.
    const routes = createPeRoutes({
      registrations: [],
      store: { getState: async () => null, setState: async () => {} } as never,
    });
    const read = await routes.fetch(new Request("http://local/pe/homes"));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(marked);
    const refused = await routes.fetch(
      new Request("http://local/pe/homes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firm: "relative" }),
      }),
    );
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      "absolute path",
    );
    const cleared = await routes.fetch(
      new Request("http://local/pe/homes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(cleared.status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
  } finally {
    if (existsSync(file)) rmSync(file);
    await writeHomesConfig({}).catch(() => {});
    if (existsSync(file)) rmSync(file);
  }
});

import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPackages } from "../src/packages.ts";
import { peRoutes, peRouteUrl } from "@pe/agent-contracts/pe-api";
import { admitRequest } from "../src/control.ts";
import { human, pea } from "./callers.ts";

test("only an administrator may trust executable routes; a document grant does not install code", () => {
  const rule = peRoutes["plugins.routeTrust"];
  const door = peRouteUrl("plugins.routeTrust", {
    params: { key: "route:@sample/routes/tool/index.js" },
  });
  expect(rule.permission).toBe("admin");
  expect(() => admitRequest(human, rule.permission, door)).not.toThrow();
  expect(() => admitRequest(pea(), rule.permission, door)).toThrow();
  expect(() =>
    admitRequest(human, rule.permission, door, { paired: true, allowAdministration: false }),
  ).toThrow();
});

test("undeclared modules and malformed route declarations never become executable contributions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-route-admission-"));
  try {
    await mkdir(join(root, "sample/routes/tool"), { recursive: true });
    await writeFile(
      join(root, "sample/routes/tool/index.js"),
      "throw Error('must not run in host')",
    );
    await writeFile(join(root, "sample/pod.json"), '{"id":"sample"}');
    expect((await listPackages(root)).packages[0]!.contributions).toEqual([]);
    await writeFile(
      join(root, "sample/pod.json"),
      JSON.stringify({
        id: "sample",
        routes: [
          { sourcePath: "pages/tour/index.html", name: "HTML is not a route", description: "" },
        ],
      }),
    );
    const pod = (await listPackages(root)).packages[0]!;
    expect(pod.diagnostics.some((d) => d.code === "InvalidRoute")).toBe(true);
    expect(pod.contributions.some((c) => c.kind === "route")).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

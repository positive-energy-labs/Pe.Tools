import { expect, test } from "vite-plus/test";
import { fileURLToPath } from "node:url";
import { buildRouteArtifact } from "./route-module-hash.ts";
import { data } from "../../../examples/pods/snowdon-circuits/routes/voltage-drop/module.ts";

/*
 * The Pod-facing surface (`@pe/web/route`, src/route/defaults.ts) bundles into a Pod without the
 * shell runtimes: the Pod build refuses `effect`, React and @pe/kit unless pinned. ef54e4dd broke it
 * when route() reached the command catalog (findings command -> semantic-actions -> decoders -> effect).
 * A one-line Pod entry re-exporting the whole surface must build; anything it reaches is a Pod's too.
 */
test("a Pod entry importing the whole @pe/web/route surface bundles without effect or another shell runtime", async () => {
  const entry = fileURLToPath(new URL("./src/route/pod-surface.entry.ts", import.meta.url));
  const built = await buildRouteArtifact({
    entry,
    source: 'export * from "./defaults.ts";\n',
    root: fileURLToPath(new URL(".", import.meta.url)),
    data,
    contracts: [{ id: "surface-guard", bytes: new TextEncoder().encode("surface guard") }],
  });
  const bytes = new TextDecoder().decode(built.executables[0]!.members.find((m) => m.path === "route.js")!.bytes);
  expect(bytes).toContain("paneLayout");
  expect(bytes).not.toMatch(/from ["']effect/);
}, 120_000);

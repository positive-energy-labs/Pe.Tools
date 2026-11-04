import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";
import { expect, test } from "vite-plus/test";

test("Pod fixture build carries the declared route artifact bytes", async () => {
  const entry = fileURLToPath(new URL("./pod-fixtures.ts", import.meta.url));
  const artifact = readFileSync(
    new URL(
      "../../../../../examples/pods/snowdon-circuits/routes/voltage-drop/route.artifact",
      import.meta.url,
    ),
  );
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["es"] },
      rolldownOptions: { external: ["@pe/agent-contracts"] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const code = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .filter((output) => output.type === "chunk")
    .map((output) => output.code)
    .join("\n");
  expect(code.includes(artifact.toString("base64"))).toBe(true);
});

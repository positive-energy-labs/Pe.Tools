import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";

const src = resolve(import.meta.dirname, "../../../packages/mcps/src");

test("Pea has one capability admission door", () => {
  const owners = readdirSync(src, { recursive: true })
    .filter((path) => String(path).endsWith(".ts"))
    .flatMap((path) =>
      [
        ...readFileSync(resolve(src, String(path)), "utf8").matchAll(/function runCapability\b/g),
      ].map(() => String(path).replaceAll("\\", "/")),
    );
  expect(owners).toEqual(["shared/admission.ts"]);
});

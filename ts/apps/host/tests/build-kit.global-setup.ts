// The host serves `kit/pe-kit.js` and `kit/pe-kit.css` from `@pe/kit`'s build output on the dev lane
// (`PAGE_LIBRARY_SOURCES`), and that output is never committed. Every host test run builds it here,
// so a run of one file reads the same bytes the whole suite does.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default function buildKit() {
  execSync("pnpm --filter @pe/kit build", {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    // Vitest runs this under NODE_ENV=test, and a build there compiles JSX to `jsxDEV` against
    // production React: every kit component then throws "jsxDEV is not a function" in a Page.
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  // The built bytes are the proof, not the flag: a development kit fails every host test here (fa689643 review).
  if (readFileSync(new URL("../../../packages/kit/dist/pe-kit.js", import.meta.url), "utf8").includes("jsxDEV"))
    throw Error("@pe/kit built a development bundle (jsxDEV); host tests need the production kit");
}

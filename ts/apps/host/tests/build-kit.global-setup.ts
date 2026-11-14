// The host serves `kit/pe-kit.js` and `kit/pe-kit.css` from `@pe/kit`'s build output on the dev lane
// (`PAGE_LIBRARY_SOURCES`), and that output is never committed. Every host test run builds it here,
// so a run of one file reads the same bytes the whole suite does.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function buildKit() {
  execSync("pnpm --filter @pe/kit build", {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: ["ignore", "ignore", "inherit"],
  });
}

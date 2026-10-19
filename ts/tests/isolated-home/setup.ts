// Per test file: its own product home under the run's temp root, so one file's state never reaches
// the next. Runs in the worker before the file imports anything (see global-setup.ts).
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const root = process.env.PE_TEST_HOME_ROOT;
if (!root) throw new Error("isolated-home/setup.ts needs the isolated-home global setup.");
const home = mkdtempSync(join(root, "file-"));
process.env.PE_TOOLS_PRODUCT_HOME = join(home, "product");
process.env.LOCALAPPDATA = join(home, "local");
// SDK known-folder discovery needs exclusive roots, not LOCALAPPDATA alone.
process.env.PE_SESSION_REGISTRY_ROOT = join(home, "sdk", "registry");
process.env.PE_SESSION_FILES_ROOT = join(home, "sdk", "files");
process.env.PE_SERVICE_STATE_ROOT = join(home, "sdk", "services");

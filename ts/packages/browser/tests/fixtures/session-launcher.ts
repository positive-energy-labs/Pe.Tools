// Launches a session-lifetime browser, records its id, and exits: the launcher a task runner would be.
import { writeFile } from "node:fs/promises";
import { openBrowser } from "../../src/browser.ts";

const [home, idFile] = process.argv.slice(2);
const session = await openBrowser({ home, lifetime: "session" });
await session.disconnect();
await writeFile(idFile!, session.info.id);

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createServer } from "vite-plus";
import { chooseServicePort, rememberServicePort } from "@pe/host-contracts/pe-service-host";
import { productRoot } from "@pe/host-contracts/service-identity";

if (!process.send) throw new Error("Run vp run dev from the host or workspace package.");
const disconnected = once(process, "disconnect");
const [file] = await Promise.race([
  once(process, "message") as Promise<[{ port: number; sourceRoot: string; name: string }]>,
  disconnected.then(() => {
    throw new Error("Host exited before frontend startup");
  }),
]);
const webRoot = resolve(import.meta.dirname, "../../web");
const sourceRoot = resolve(webRoot, "../..");
if (resolve(file.sourceRoot).toLowerCase() !== sourceRoot.toLowerCase())
  throw new Error("Dev frontend and host must belong to the same checkout.");
const name = file.name + "-web";
const baseUrl = `http://127.0.0.1:${file.port}`;
process.env.PE_TOOLS_HOST_BASE_URL = baseUrl;
// Each launch owns its optimizer files, including after an abrupt backend/watch exit.
const cacheDir = await mkdtemp(join(tmpdir(), "pe-vite-"));
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
try {
  vite = await createServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    cacheDir,
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port: await chooseServicePort(productRoot(), name, 0),
    },
  });
  await vite.listen();
  const address = vite.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("Vite did not bind TCP");
  await rememberServicePort(productRoot(), name, address.port);
  const url = `http://127.0.0.1:${address.port}`;
  console.log(
    `Dev checkout: ${sourceRoot}\nBrowser: ${url}\nBackend: ${baseUrl} (pid ${process.ppid})`,
  );
  if (process.connected)
    await new Promise<void>((resolve, reject) =>
      process.send!(url, (error) => (error ? reject(error) : resolve())),
    );
  await disconnected;
} finally {
  await vite?.close();
  await rm(cacheDir, { recursive: true, force: true });
}

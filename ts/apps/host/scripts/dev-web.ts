import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "vite-plus";
import { chooseServicePort, rememberServicePort } from "@pe/host-contracts/pe-service-host";
import { checkoutRootFrom, productRoot } from "@pe/host-contracts/service-identity";

if (!process.send) throw new Error("Run vp run dev from the host or workspace package.");
const disconnected = once(process, "disconnect");
const [file] = await Promise.race([
  once(process, "message") as Promise<[{ port: number; sourceRoot: string; name: string }]>,
  disconnected.then(() => {
    throw new Error("Host exited before frontend startup");
  }),
]);
const webRoot = resolve(import.meta.dirname, "../../web");
const sourceRoot = checkoutRootFrom(webRoot);
if (!sourceRoot || resolve(file.sourceRoot).toLowerCase() !== sourceRoot.toLowerCase())
  throw new Error("Dev frontend and host must belong to the same checkout.");
const name = file.name + "-web";
const baseUrl = `http://127.0.0.1:${file.port}`;
process.env.PE_TOOLS_HOST_BASE_URL = baseUrl;
// Each launch owns its optimizer files, including after an abrupt backend/watch exit.
const cacheDir = await mkdtemp(join(tmpdir(), "pe-vite-"));
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let share: ChildProcess | undefined;
try {
  vite = await createServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    cacheDir,
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port: await chooseServicePort(productRoot(), name, 0),
      // Vite refuses unknown Host headers; a --share visitor arrives as <machine>.<tailnet>.ts.net.
      ...(process.argv.includes("--share") ? { allowedHosts: [".ts.net"] } : {}),
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
  // --share: publish this frontend to the tailnet. Vite proxies every host route, so the host
  // stays loopback-only and only the Vite port is forwarded. The CLI prints an enable link and
  // waits when Serve is off for the tailnet (even with --yes, seen 2026-10-01), so it runs as a
  // child and the rule is cleared on exit.
  if (process.argv.includes("--share")) {
    share = spawn("tailscale", ["serve", "--yes", "--bg", String(address.port)], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    share.on("exit", (code) => {
      if (code !== 0) return;
      const status = execFileSync("tailscale", ["serve", "status"], { encoding: "utf8" });
      console.log(`Shared: ${status.trim()}`);
    });
  }
  if (process.connected)
    await new Promise<void>((resolve, reject) =>
      process.send!(url, (error) => (error ? reject(error) : resolve())),
    );
  await disconnected;
} finally {
  // Only this rule: `reset` would also drop another repo's share on the same machine.
  if (share?.exitCode === 0)
    execFileSync("tailscale", ["serve", "--https=443", "off"], { stdio: "ignore" });
  else share?.kill();
  await vite?.close();
  await rm(cacheDir, { recursive: true, force: true });
}

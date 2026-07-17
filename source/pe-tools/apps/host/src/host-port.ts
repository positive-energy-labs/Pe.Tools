import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { hostOwnership, productRoot } from "./host-ownership.ts";

const initialPreferredPort = Number(new URL(hostProcessIdentity.defaultHostBaseUrl).port);

function preferencePath(): string {
  return join(productRoot(), "state", "service", `${hostOwnership.serviceName}.port`);
}

function serviceFilePath(): string {
  return join(productRoot(), "state", "service", `${hostOwnership.serviceName}.json`);
}

async function readPreferredPort(): Promise<number> {
  try {
    const port = Number.parseInt((await readFile(preferencePath(), "utf8")).trim(), 10);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : initialPreferredPort;
  } catch {
    return initialPreferredPort;
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  if (port === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

export async function chooseHostPort(): Promise<number> {
  // A same-name incumbent means this launch is a takeover candidate: bind elsewhere first.
  if (existsSync(serviceFilePath())) return 0;
  const preferred = await readPreferredPort();
  return (await isPortAvailable(preferred)) ? preferred : 0;
}

export async function rememberHostPort(port: number): Promise<void> {
  const path = preferencePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, String(port), "utf8");
}

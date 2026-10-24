import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping.js";
import type { CdpEvent, CdpTarget, CommandOptions } from "./cdp.ts";
import { SessionClient } from "./client.ts";
import { activeEndpoint, browserHome, defaultChromeProfile } from "./platform.ts";
import { readSessionReceipt } from "./receipts.ts";
import { BrowserError } from "./errors.ts";

export interface OpenBrowserOptions {
  mode?: "headless" | "visible";
  executablePath?: string;
  profile?: string;
  home?: string;
  args?: string[];
  timeoutMs?: number;
  lifetime?: "caller" | "session";
}
export interface AttachBrowserOptions {
  endpoint?: string | number;
  autoConnect?: boolean;
  profile?: string;
  home?: string;
  timeoutMs?: number;
  clientId?: string;
}
export interface SessionInfo {
  id: string;
  custody: "owned" | "attached";
  mode: "headless" | "visible" | "attached";
  endpoint: string;
  pid?: number;
  executablePath?: string;
  browserVersion?: string;
  profile?: string;
  temporaryProfile: boolean;
  keeperPid?: number;
  guardianPid?: number;
  receipt: string;
  receiptId: string;
  createdAt: string;
}
export interface BrowserPage {
  targetId: string;
  send<M extends keyof ProtocolMapping.Commands>(
    method: M,
    ...params: ProtocolMapping.Commands[M]["paramsType"]
  ): Promise<ProtocolMapping.Commands[M]["returnType"]>;
  sendRaw(
    method: string,
    params?: Record<string, unknown>,
    options?: CommandOptions,
  ): Promise<unknown>;
  subscribe(listener: (event: CdpEvent) => void): () => void;
  close(): Promise<void>;
  release(): Promise<void>;
}
export interface BrowserSession {
  info: SessionInfo;
  targets(): Promise<CdpTarget[]>;
  page(options?: { targetId?: string; url?: string; clientId?: string }): Promise<BrowserPage>;
  protocol(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
  disconnect(): Promise<void>;
  /** Privileged browser protocol access. Attached custody is not a raw-CDP security sandbox. */
  sendRaw(
    method: string,
    params?: Record<string, unknown>,
    options?: CommandOptions,
  ): Promise<unknown>;
}
export interface SessionReceipt {
  info: SessionInfo;
  controlPort: number;
  token: string;
  status: "active" | "closed";
  error?: string;
  errorCode?: string;
  errorData?: unknown;
}
export interface KeeperConfig {
  id: string;
  token: string;
  home: string;
  open?: OpenBrowserOptions;
  attach?: AttachBrowserOptions;
  lifetime: "caller" | "session";
}

async function start(
  config: Omit<KeeperConfig, "id" | "token" | "home"> & { home?: string },
): Promise<BrowserSession> {
  const home = browserHome(config.home);
  const id = randomUUID();
  const token = randomUUID();
  const directory = join(home, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const full: KeeperConfig = { ...config, id, token, home };
  const configFile = join(directory, "config.json");
  await writeFile(configFile, JSON.stringify(full), { mode: 0o600 });
  const extension = import.meta.url.endsWith(".ts")
    ? ".ts"
    : import.meta.url.endsWith(".mjs")
      ? ".mjs"
      : ".js";
  const keeper = fileURLToPath(new URL(`./keeper${extension}`, import.meta.url));
  const child = spawn(process.execPath, [keeper, configFile], {
    detached: true,
    windowsHide: true,
    stdio: [config.lifetime === "caller" ? "pipe" : "ignore", "ignore", "pipe"],
  });
  let stderr = "";
  let spawnError: Error | undefined;
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + String(chunk)).slice(-12000);
  });
  child.once("error", (error) => {
    spawnError = error;
  });
  const deadline =
    Date.now() + (config.open?.timeoutMs ?? config.attach?.timeoutMs ?? 20000) + 5000;
  const receiptFile = join(directory, "session.json");
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      const receipt = await readSessionReceipt(receiptFile, true);
      if (receipt?.status === "closed")
        throw new BrowserError(
          receipt.errorCode ?? "LaunchFailed",
          receipt.error ?? "Browser keeper failed",
          { outcome: "not-sent", data: receipt.errorData },
        );
      if (receipt?.status === "active") {
        const session = await SessionClient.connect(receipt, config.attach?.clientId);
        if (config.lifetime === "caller") session.onDisconnected = () => child.stdin?.end();
        child.unref();
        child.stderr?.destroy();
        return session;
      }
      if (child.exitCode !== null) throw new Error(`Keeper exited ${child.exitCode}: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new BrowserError("Timeout", `Browser keeper startup deadline exceeded: ${stderr}`, {
      outcome: "not-sent",
    });
  } catch (error) {
    child.stdin?.end();
    child.kill();
    throw error;
  }
}
export const openBrowser = (options: OpenBrowserOptions = {}): Promise<BrowserSession> =>
  start({ open: options, home: options.home, lifetime: options.lifetime ?? "caller" });
export async function attachBrowser(options: AttachBrowserOptions): Promise<BrowserSession> {
  if (!options.endpoint && !options.autoConnect)
    throw new BrowserError("InvalidOptions", "Specify endpoint or autoConnect", {
      outcome: "not-sent",
    });
  if (!options.endpoint) {
    options = { ...options, profile: options.profile ?? defaultChromeProfile() };
    try {
      options = { ...options, endpoint: await activeEndpoint(options.profile!) };
    } catch (cause) {
      throw new BrowserError(
        "ConsentPending",
        "Chrome consent discovery pending. Enable chrome://inspect/#remote-debugging in the selected running Chrome and approve its connection prompt, then retry.",
        { cause, outcome: "not-sent" },
      );
    }
  }
  return start({ attach: options, home: options.home, lifetime: "session" });
}
export async function connectBrowser(
  id: string,
  options: { home?: string; clientId?: string } = {},
): Promise<BrowserSession> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid browser session id");
  const receipt = (await readSessionReceipt(join(browserHome(options.home), id, "session.json")))!;
  if (receipt.info.id !== id)
    throw new BrowserError("InvalidReceipt", `Receipt id does not match ${id}`, {
      outcome: "not-sent",
    });
  if (receipt.status !== "active")
    throw new BrowserError("SessionClosed", "Session is closed", { outcome: "not-sent" });
  return SessionClient.connect(receipt, options.clientId);
}
export async function listBrowsers(options: { home?: string } = {}): Promise<SessionInfo[]> {
  const home = browserHome(options.home);
  let entries;
  try {
    entries = await readdir(home, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: SessionInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    let session: BrowserSession | undefined;
    try {
      // Profiles and unrelated directories are not sessions; an existing bad receipt is an error.
      if (!(await readSessionReceipt(join(home, id, "session.json"), true))) continue;
      session = await connectBrowser(id, options);
      result.push(session.info);
    } catch (error) {
      if (
        !["ENOENT", "ENOTDIR", "ECONNREFUSED", "SessionClosed"].includes(
          (error as { code?: string }).code ?? "",
        )
      )
        throw error;
    } finally {
      await session?.disconnect();
    }
  }
  return result;
}

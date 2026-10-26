import { randomUUID } from "node:crypto";
import { createServer, type Socket, type Server } from "node:net";
import { appendFile, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Effect, Semaphore } from "effect";
import type { KeeperConfig, SessionInfo, SessionReceipt } from "./browser.ts";
import { connectCdp, type CdpClient } from "./cdp.ts";
import { getBrowserEndpoint, getProtocol } from "./protocol.ts";
import { CLOSE_BUDGET_MS, publishJson, publishSessionReceipt } from "./receipts.ts";
import { acquireAttachment, releaseAttachment, type AttachmentLock } from "./attachment-lock.ts";
import { guardianClient } from "./attached-guardian.ts";
import { browserWorkerCommand } from "./worker.ts";
import { BrowserError } from "./errors.ts";
import {
  activeEndpoint,
  assertProfileAvailable,
  chromeExecutable,
  defaultChromeProfile,
  launchGuarded,
  type Guardian,
} from "./platform.ts";

interface Lease {
  socket: Socket;
  sessionId: string;
  created: boolean;
}
interface Request {
  id: string;
  token: string;
  op: string;
  args?: Record<string, unknown>;
}
const attempt = <A>(body: () => Promise<A>) =>
  Effect.tryPromise({ try: body, catch: (error) => error });
const ignore = (body: () => Promise<unknown>) =>
  Effect.promise(async () => {
    try {
      await body();
    } catch {}
  });

export async function runBrowserKeeper(configFile: string): Promise<void> {
  const config: KeeperConfig = JSON.parse(await readFile(configFile, "utf8"));
  const directory = join(config.home, config.id);
  const receiptFile = join(directory, "session.json");
  const trace = (phase: string, detail?: unknown) =>
    appendFile(
      join(directory, "lifecycle-timeline.jsonl"),
      JSON.stringify({ phase, when: new Date().toISOString(), pid: process.pid, detail }) + "\n",
    );
  const leases = new Map<string, Lease>();
  const created = new Set<string>();
  const sockets = new Set<Socket>();
  const pending = new Map<string, { controller: AbortController; socket: Socket }>();
  let guardian: Guardian | undefined;
  let attachedGuardian: ReturnType<typeof spawn> | undefined;
  let attachmentLock: AttachmentLock | undefined;
  let cdp: CdpClient | undefined;
  let server: Server | undefined;
  let lock: string | undefined;
  let allocatedProfile: string | undefined;
  let info: SessionInfo = {
    id: config.id,
    custody: config.open ? "owned" : "attached",
    mode: config.open?.mode ?? (config.open ? "headless" : "attached"),
    endpoint: "",
    temporaryProfile: !config.open?.profile && !!config.open,
    keeperPid: process.pid,
    receipt: receiptFile,
    receiptId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  let receipt: SessionReceipt | undefined;
  let finish: (() => void) | undefined;
  let closing = false;
  let errorText: string | undefined;
  let errorCode: string | undefined;
  let errorData: unknown;
  const writeReceipt = async (status: "active" | "closed") => {
    await publishSessionReceipt(receiptFile, {
      ...(receipt ?? { controlPort: 0, token: config.token }),
      info,
      status,
      ...(errorText ? { error: errorText, errorCode, errorData } : {}),
    });
  };
  const persistCreated = () =>
    writeFile(join(directory, "created-targets.json"), JSON.stringify([...created]));
  const retire = async (targetId: string, close: boolean, socket?: Socket) => {
    const lease = leases.get(targetId);
    if (!lease || (socket && lease.socket !== socket))
      throw new BrowserError("PageBusy", "Page is not leased by this client", {
        outcome: "not-sent",
      });
    // Borrowed tabs can be released, never closed by lifecycle cleanup.
    if (close && !lease.created)
      throw new BrowserError("BorrowedPage", "Borrowed page cannot be closed; use release", {
        outcome: "not-sent",
      });
    leases.delete(targetId);
    await cdp!.sendRaw("Target.detachFromTarget", { sessionId: lease.sessionId }).catch(() => {});
    if (close && lease.created) {
      await cdp!.sendRaw("Target.closeTarget", { targetId });
      created.delete(targetId);
      await persistCreated();
    }
  };
  const program = Effect.scoped(
    Effect.gen(function* () {
      const mutex = yield* Semaphore.make(1);
      // The scope is acquired before any process/profile mutation, so partial launch failures unwind too.
      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.gen(function* () {
          closing = true;
          const deadlineMs = Date.now() + CLOSE_BUDGET_MS;
          yield* ignore(() =>
            publishJson(join(directory, "closing.json"), { receiptId: info.receiptId, deadlineMs }),
          );
          yield* ignore(() => trace("cleanup.begin"));
          for (const operation of pending.values()) operation.controller.abort();
          for (const socket of sockets) socket.destroy();
          if (server) yield* ignore(() => new Promise<void>((done) => server!.close(() => done())));
          yield* ignore(() => trace("server.closed"));
          if (cdp) {
            // Owned browser shutdown closes all tabs once; only attachments need per-target retirement.
            for (const targetId of config.open ? [] : created)
              yield* ignore(() =>
                trace("target.close.begin", targetId)
                  .then(() => cdp!.sendRaw("Target.closeTarget", { targetId }, { timeoutMs: 1000 }))
                  .finally(() => trace("target.close.end", targetId)),
              );
            created.clear();
            yield* ignore(persistCreated);
            if (config.open)
              yield* ignore(() =>
                trace("browser.close.begin")
                  .then(() => cdp!.sendRaw("Browser.close", {}, { timeoutMs: 3000 }))
                  .then(
                    (result) => trace("browser.close.replied", result),
                    (error) =>
                      trace("browser.close.error", {
                        code: (error as BrowserError).code,
                        message: (error as Error).message,
                      }),
                  )
                  .finally(() => trace("browser.close.end")),
              );
            yield* ignore(() => cdp!.close());
          }
          if (guardian)
            yield* Effect.promise(async () => {
              try {
                await trace("guardian.stop.begin");
                await guardian!.stop(Math.max(1, deadlineMs - Date.now()));
                await trace("guardian.stop.end");
              } catch (error) {
                await trace("guardian.stop.failed", String(error));
                errorText = String(error);
                errorCode = "CleanupFailed";
              }
            });
          if (attachedGuardian) {
            attachedGuardian.stdin?.end();
            yield* ignore(
              () =>
                new Promise<void>((done) => {
                  if (attachedGuardian!.exitCode !== null) done();
                  else attachedGuardian!.once("exit", () => done());
                }),
            );
          }
          if (attachmentLock) yield* ignore(() => releaseAttachment(attachmentLock!));
          if (lock && !guardian)
            yield* ignore(async () => {
              if ((await readFile(lock!, "utf8")) === config.id) await rm(lock!);
            });
          if (!guardian && info.temporaryProfile && allocatedProfile)
            yield* ignore(async () => {
              if (
                (await readFile(join(allocatedProfile!, ".pe-browser-owner"), "utf8")) === config.id
              )
                await rm(allocatedProfile!, { recursive: true, force: true });
            });
        }),
      );
      yield* attempt(async () => {
        if (config.open) {
          const options = config.open;
          const executable = await chromeExecutable(options.executablePath);
          const profile = resolve(options.profile ?? join(directory, "profile"));
          allocatedProfile = profile;
          // Owned launch never adopts the daily Chrome user-data root.
          const daily = resolve(defaultChromeProfile());
          if (
            daily &&
            (profile.toLowerCase() === daily.toLowerCase() ||
              profile
                .toLowerCase()
                .startsWith(daily.toLowerCase() + (process.platform === "win32" ? "\\" : "/")))
          )
            throw new Error(
              "Daily Chrome profiles require explicit consented attach, not owned launch",
            );
          await assertProfileAvailable(profile);
          await mkdir(profile, { recursive: true });
          lock = profile + ".pe-browser.lock";
          try {
            const handle = await open(lock, "wx", 0o600);
            await handle.writeFile(config.id);
            await handle.close();
          } catch (cause) {
            lock = undefined;
            throw new BrowserError("ProfileBusy", "Retained profile is already leased", {
              cause,
              outcome: "not-sent",
            });
          }
          await writeFile(join(profile, ".pe-browser-owner"), config.id);
          // Endpoint freshness is tied to this owned launch, never a stale prior file.
          await rm(join(profile, "DevToolsActivePort"), { force: true });
          const args = options.args ?? [];
          if (
            args.some((arg) => /^--(user-data-dir|remote-debugging|headless)(?:[=-]|$)/.test(arg))
          )
            throw new Error("Launch args cannot override lifecycle profile/debugging/mode flags");
          guardian = await launchGuarded({
            id: config.id,
            directory,
            executable,
            profile,
            temporary: !options.profile,
            lock,
            args: [
              "--remote-debugging-address=127.0.0.1",
              "--remote-debugging-port=0",
              `--user-data-dir=${profile}`,
              "--no-first-run",
              "--no-default-browser-check",
              "--disable-background-timer-throttling",
              "--disable-renderer-backgrounding",
              "--window-size=1000,760",
              ...(info.mode === "headless" ? ["--headless=new"] : []),
              ...args,
              "about:blank",
            ],
          });
          info = {
            ...info,
            executablePath: executable,
            profile,
            pid: guardian.pid,
            guardianPid: guardian.process.pid,
          };
          const deadline = Date.now() + (options.timeoutMs ?? 20000);
          let last: unknown;
          while (Date.now() < deadline) {
            if (guardian.process.exitCode !== null)
              throw new Error("Chrome guardian exited during launch");
            try {
              info.endpoint = await activeEndpoint(profile);
              break;
            } catch (error) {
              last = error;
            }
            await new Promise((done) => setTimeout(done, 50));
          }
          if (!info.endpoint)
            throw new Error("Chrome launch endpoint deadline exceeded", { cause: last });
        } else {
          info = {
            ...info,
            endpoint: await getBrowserEndpoint(config.attach!.endpoint!),
            profile: config.attach?.profile,
          };
          attachmentLock = await acquireAttachment(info.endpoint, {
            id: info.id,
            home: config.home,
            receipt: receiptFile,
            receiptId: info.receiptId,
          });
        }
        if (config.open) {
          cdp = await connectCdp(info.endpoint, { timeoutMs: config.open.timeoutMs ?? 20000 });
        } else {
          await persistCreated();
          const guardianFile = join(directory, "attached-guardian.json");
          await writeFile(
            guardianFile,
            JSON.stringify({
              endpoint: info.endpoint,
              receipt: receiptFile,
              lock: attachmentLock,
              timeoutMs: config.attach?.timeoutMs ?? 20000,
            }),
            { mode: 0o600 },
          );
          const worker = browserWorkerCommand("attached-guardian", guardianFile);
          attachedGuardian = spawn(worker.command, worker.args, {
            detached: true,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
          });
          attachedGuardian.on("error", () => {});
          attachedGuardian.stderr?.on("data", () => {});
          info = { ...info, guardianPid: attachedGuardian.pid };
          cdp = guardianClient(
            await connectCdp(
              { readable: attachedGuardian.stdout!, writable: attachedGuardian.stdin! },
              { timeoutMs: config.attach?.timeoutMs ?? 20000 },
            ),
          );
        }
        const version = (await cdp.sendRaw(
          "Browser.getVersion",
          {},
          { timeoutMs: config.open?.timeoutMs ?? config.attach?.timeoutMs ?? 20000 },
        )) as { product: string };
        info.browserVersion = version.product;
      });
      cdp!.subscribe((event) => {
        if (!event.sessionId) return;
        for (const [targetId, lease] of leases)
          if (lease.sessionId === event.sessionId && !lease.socket.destroyed)
            lease.socket.write(JSON.stringify({ targetId, event }) + "\n");
      });
      const locked = <A>(body: () => Promise<A>) =>
        Effect.runPromise(mutex.withPermit(attempt(body)));
      const dispatch = async (socket: Socket, request: Request): Promise<unknown> => {
        const args = request.args ?? {};
        if (closing)
          throw new BrowserError("SessionClosed", "Browser session is closing", {
            outcome: "not-sent",
          });
        switch (request.op) {
          case "info":
            return info;
          case "targets": {
            const result = (await cdp!.sendRaw("Target.getTargets")) as {
              targetInfos: { targetId: string; type: string; title: string; url: string }[];
            };
            return result.targetInfos.map((target) => ({
              id: target.targetId,
              type: target.type,
              title: target.title,
              url: target.url,
              webSocketDebuggerUrl: new URL(`/devtools/page/${target.targetId}`, info.endpoint)
                .href,
            }));
          }
          case "protocol":
            return getProtocol(info.endpoint, { allowBundled: true, client: cdp! });
          case "page":
            return locked(async () => {
              if (args.url !== undefined && typeof args.url !== "string")
                throw new BrowserError("InvalidOptions", "Page url must be a string", {
                  outcome: "not-sent",
                });
              let targetId = typeof args.targetId === "string" ? args.targetId : undefined;
              let own = false;
              if (targetId && leases.has(targetId))
                throw new BrowserError("PageBusy", `Target ${targetId} is already leased`, {
                  outcome: "not-sent",
                  data: { targetId },
                });
              if (!targetId) {
                const result = (await cdp!.sendRaw("Target.createTarget", {
                  url: args.url ?? "about:blank",
                })) as { targetId: string };
                targetId = result.targetId;
                own = true;
                created.add(targetId);
                await persistCreated();
              }
              try {
                const attached = (await cdp!.sendRaw("Target.attachToTarget", {
                  targetId,
                  flatten: true,
                })) as { sessionId: string };
                leases.set(targetId, {
                  socket,
                  sessionId: attached.sessionId,
                  created: info.custody === "owned" || own || created.has(targetId),
                });
                if (args.url && !own)
                  await cdp!.sendRaw(
                    "Page.navigate",
                    { url: args.url },
                    { sessionId: attached.sessionId },
                  );
                return { targetId };
              } catch (error) {
                if (own) {
                  await cdp!.sendRaw("Target.closeTarget", { targetId }).catch(() => {});
                  created.delete(targetId);
                  await persistCreated();
                }
                throw error;
              }
            });
          case "page.close":
          case "page.release":
            return locked(async () => {
              await retire(String(args.targetId), request.op === "page.close", socket);
              return null;
            });
          case "page.send":
          case "browser.send": {
            const controller = pending.get(request.id)?.controller ?? new AbortController();
            pending.set(request.id, { controller, socket });
            try {
              const lease =
                request.op === "page.send" ? leases.get(String(args.targetId)) : undefined;
              if (request.op === "page.send" && (!lease || lease.socket !== socket))
                throw new BrowserError("PageBusy", "Page is not leased by this client", {
                  outcome: "not-sent",
                });
              return await cdp!.sendRaw(
                String(args.method),
                (args.params as Record<string, unknown>) ?? {},
                {
                  ...(lease ? { sessionId: lease.sessionId } : {}),
                  signal: controller.signal,
                  timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
                },
              );
            } finally {
              pending.delete(request.id);
            }
          }
          case "cancel":
            if (pending.get(String(args.requestId))?.socket === socket)
              pending.get(String(args.requestId))?.controller.abort();
            return null;
          case "close":
            setTimeout(() => finish?.(), 20);
            return null;
          default:
            throw new BrowserError("InvalidOperation", `Unknown keeper operation ${request.op}`, {
              outcome: "not-sent",
            });
        }
      };
      yield* attempt(async () => {
        server = createServer((socket) => {
          sockets.add(socket);
          socket.setEncoding("utf8");
          let buffer = "";
          socket.on("error", () => {});
          socket.on("close", () => {
            sockets.delete(socket);
            for (const operation of pending.values())
              if (operation.socket === socket) operation.controller.abort();
            if (closing) return;
            void locked(async () => {
              for (const [targetId, lease] of leases)
                if (lease.socket === socket) await retire(targetId, lease.created).catch(() => {});
            });
          });
          socket.on("data", (chunk: string) => {
            buffer += chunk;
            if (buffer.length > 16 * 1024 * 1024) {
              socket.destroy();
              return;
            }
            let index: number;
            while ((index = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, index);
              buffer = buffer.slice(index + 1);
              let request: Request;
              try {
                request = JSON.parse(line);
              } catch {
                socket.destroy();
                return;
              }
              if (request.token !== config.token || typeof request.id !== "string") {
                socket.destroy();
                return;
              }
              const startedAt = new Date().toISOString();
              if (request.op.endsWith(".send"))
                pending.set(request.id, { controller: new AbortController(), socket });
              const operation = {
                keeperRequestId: request.id,
                sessionId: info.id,
                receiptId: info.receiptId,
                method: request.args?.method,
                targetId: request.args?.targetId,
                startedAt,
              };
              const journal = async (state: Record<string, unknown>) => {
                if (!request.op.endsWith(".send")) return;
                const file = await open(join(directory, "operations.jsonl"), "a", 0o600);
                try {
                  await file.writeFile(JSON.stringify({ ...operation, ...state }) + "\n");
                  await file.sync();
                } finally {
                  await file.close();
                }
              };
              void journal({ state: "started", outcome: "unknown" })
                .then(() => dispatch(socket, request))
                .then(async (result) => {
                  await journal({
                    state: "finished",
                    finishedAt: new Date().toISOString(),
                    outcome: "completed",
                  });
                  if (!socket.destroyed)
                    socket.write(JSON.stringify({ id: request.id, result: result ?? null }) + "\n");
                })
                .catch(async (error) => {
                  const e = error as Error & {
                    code?: string;
                    method?: string;
                    outcome?: string;
                    requestId?: number;
                    protocolCode?: number;
                    data?: unknown;
                  };
                  const result = {
                    message: e.message,
                    code: e.code ?? "LifecycleError",
                    method: e.method,
                    outcome: e.outcome,
                    requestId: e.requestId,
                    protocolCode: e.protocolCode,
                    data: e.data,
                  };
                  try {
                    await journal({
                      state: "finished",
                      finishedAt: new Date().toISOString(),
                      ...result,
                    });
                  } catch (journalError) {
                    socket.destroy(journalError as Error);
                    return;
                  }
                  if (!socket.destroyed)
                    socket.write(JSON.stringify({ id: request.id, error: result }) + "\n");
                });
            }
          });
        });
        await new Promise<void>((done, reject) => {
          server!.once("error", reject);
          server!.listen(0, "127.0.0.1", done);
        });
        receipt = {
          info,
          token: config.token,
          controlPort: (server.address() as { port: number }).port,
          status: "active",
        };
        await writeReceipt("active");
      });
      yield* Effect.promise(
        () =>
          new Promise<void>((done) => {
            finish = done;
            process.once("SIGTERM", done);
            process.once("SIGINT", done);
            if (config.lifetime === "caller") {
              process.stdin.resume();
              process.stdin.once("end", done);
              if (process.stdin.readableEnded) done();
            }
            guardian?.process.once("exit", done);
          }),
      );
    }),
  );
  try {
    await Effect.runPromise(program);
  } catch (error) {
    errorText = error instanceof Error ? error.message : String(error);
    errorCode = (error as { code?: string }).code;
    errorData = (error as { data?: unknown }).data;
    throw error;
  } finally {
    await trace("terminal.begin", { errorCode });
    await writeReceipt("closed");
    await trace("terminal.published", { errorCode });
  }
}

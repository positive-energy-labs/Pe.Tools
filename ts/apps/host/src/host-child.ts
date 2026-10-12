import { execFile, spawn } from "node:child_process";
import { Effect } from "effect";

/** Native options reach Node unchanged; Effect's process adapter drops windowsHide. */
export function runHostChild(
  command: string,
  args: readonly string[],
  options: { cwd?: string; windowsHide?: boolean; all?: boolean } = {},
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const running = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const child = spawn(command, [...args], {
              cwd: options.cwd,
              windowsHide: options.windowsHide ?? true,
              detached: process.platform !== "win32",
              stdio: ["ignore", "pipe", "pipe"],
            });
            let closed = false;
            let stdout = "";
            let output = "";
            child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
              stdout += chunk;
              if (options.all) output += chunk;
            });
            if (options.all)
              child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
            else child.stderr.resume();
            const exited = new Promise<void>((resolve) =>
              child.once("close", () => {
                closed = true;
                resolve();
              }),
            );
            const result = new Promise<{ stdout: string; output: string; exitCode: number | null }>(
              (resolve, reject) => {
                child.once("error", reject);
                child.stdout.once("error", reject);
                child.stderr.once("error", reject);
                child.once("close", (exitCode) =>
                  resolve({ stdout, output: options.all ? output : stdout, exitCode }),
                );
              },
            );
            return { child, exited, needsCleanup: () => !closed, result };
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        (running) =>
          Effect.promise(async () => {
            if (!running.needsCleanup()) return;
            const { child } = running;
            if (child.pid && process.platform === "win32")
              await new Promise<void>((resolve) =>
                execFile(
                  "taskkill",
                  ["/pid", String(child.pid), "/T", "/F"],
                  { windowsHide: true, timeout: 5000 },
                  (error) => {
                    if (error) child.kill();
                    resolve();
                  },
                ),
              );
            else if (child.pid) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill();
              }
            }
            let deadline: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                running.exited,
                new Promise<never>((_resolve, reject) => {
                  deadline = setTimeout(
                    () => reject(Error("The host child did not close after termination.")),
                    5000,
                  );
                }),
              ]);
            } finally {
              clearTimeout(deadline);
            }
          }),
      );
      return yield* Effect.tryPromise({
        try: () => running.result,
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });
    }),
  );
}

import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
export async function wait<T>(
  read: () => Promise<T | undefined>,
  label: string,
  timeout: number,
  cancelled: () => boolean = () => false,
): Promise<T> {
  const end = Date.now() + timeout;
  while (!cancelled() && Date.now() < end) {
    const result = await read();
    if (result !== undefined) return result;
    await pause(100);
  }
  throw new Error(`${cancelled() ? "Interrupted" : "Timed out"}: ${label}`);
}
export async function exited(child: ChildProcess, timeout: number) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done, reject) => {
    child.once("error", reject);
    const timer = setTimeout(
      () => reject(new Error(`Owned process ${child.pid} did not exit`)),
      timeout,
    );
    child.once("exit", () => {
      clearTimeout(timer);
      child.removeListener("error", reject);
      done();
    });
  });
}
export async function stopOwned(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32")
    await exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      timeout: 10_000,
      windowsHide: true,
    });
  else child.kill("SIGKILL");
  await exited(child, 5000);
}

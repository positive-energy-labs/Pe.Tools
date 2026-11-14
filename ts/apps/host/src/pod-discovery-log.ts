import { appendLinesBounded, stateLog, type StoredLog } from "@pe/host-contracts/kinds";
import { z } from "zod";

export const packageScanLogLineLimit = 1_000;
export const packageScanLog = stateLog({
  schema: z.string(),
  place: () => "Host Pod scan diagnostics",
  segments: () => ["pod-discovery.jsonl"],
});
let scanLog = (_message: string) => {};
export const logPackageDiscovery = (message: string) => scanLog(message);

/** Scan diagnostics reach both the host logger and a bounded, asynchronously written tail. */
export function bindPackageScanLogger(log: (message: string) => void, file?: StoredLog<string>) {
  let queued: string[] = [];
  let writing: Promise<void> | undefined;
  const flush = async () => {
    while (file && (writing || queued.length)) {
      if (!writing) {
        const batch = queued;
        queued = [];
        writing = appendLinesBounded(file, batch, packageScanLogLineLimit)
          .catch(error => log(`Pod scan log append failed: ${String(error)}`))
          .finally(() => { writing = undefined; });
      }
      await writing;
    }
  };
  scanLog = (message) => {
    // Only actual scan boundaries persist; a slow disk cannot grow the in-memory queue either.
    if (file && /^Pod folder (?:metadata )?scan (?:start|end) /.test(message)) {
      queued.push(`${new Date().toISOString()} ${message}`);
      queued = queued.slice(-packageScanLogLineLimit);
      if (!writing) void flush();
    }
    log(message);
  };
  return flush;
}

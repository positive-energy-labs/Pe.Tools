import { NodeRuntime } from "@effect/platform-node";
import { productPathNames } from "@pe/host-contracts/contracts";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hostProgram } from "./host-program.ts";
import { resolveHostVersion } from "./host-lifecycle.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import { hostReceiptExport, fatalReceipt } from "./receipt-export.ts";

// The installer stub and the login Run key start the installed host with no stdio anyone reads, so
// a host that dies before bind (a refused claim, a thrown binding) leaves nothing behind. Tee every
// console line to the shared log path on the installed lane; the dev lane keeps its launcher redirect.
if (hostOwnership.lane === "installed") {
  const dir = join(productRoot(), productPathNames.logsDirectoryName);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, productPathNames.hostLogFileName);
  for (const stream of [process.stdout, process.stderr] as const) {
    const write = stream.write.bind(stream);
    stream.write = ((chunk: string | Uint8Array, ...rest: never[]) => {
      try {
        // eslint-disable-next-line no-control-regex -- the logger colors its console lines
        appendFileSync(
          file,
          `${new Date().toISOString()} ${String(chunk).replace(/\x1b\[[0-9;]*m/g, "")}`,
        );
      } catch {
        // The log is a courtesy; never let it take the host down.
      }
      return write(chunk, ...rest);
    }) as typeof stream.write;
  }
}

// Boot breadcrumb (pre-bind). The installed boot is otherwise silent until the "Listening" line, so a
// launcher-killed slow/crashed boot leaves an empty host log that could mean five different things.
// This one line — version, pid, lane — lands in the SDK service log via the launcher's redirect
// and distinguishes "never started" from "started but died before bind". Plain console.log by design.
console.log(
  `pe-host boot v${resolveHostVersion()} pid=${process.pid} lane=${process.env.PE_LANE ?? "?"}`,
);

let fatal = false;
for (const [event, code] of [
  ["uncaughtException", "process.uncaught"],
  ["unhandledRejection", "process.unhandled-rejection"],
] as const)
  process.on(event, (error: unknown) => {
    if (fatal) return;
    fatal = true;
    void fatalReceipt(hostReceiptExport(), code, error);
  });

NodeRuntime.runMain(hostProgram());

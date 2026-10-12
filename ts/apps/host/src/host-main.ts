import { NodeRuntime } from "@effect/platform-node";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hostProgram } from "./host-program.ts";
import { resolveHostVersion } from "./host-lifecycle.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";

// The installer stub and the login Run key start the installed host with no stdio anyone reads, so
// a host that dies before bind (a refused claim, a thrown binding) leaves nothing behind. Tee every
// console line to logs/host.log on the installed lane; the dev lane keeps its launcher redirect.
if (hostOwnership.lane === "installed") {
  const dir = join(productRoot(), "logs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "host.log");
  for (const stream of [process.stdout, process.stderr] as const) {
    const write = stream.write.bind(stream);
    stream.write = ((chunk: string | Uint8Array, ...rest: never[]) => {
      try {
        // eslint-disable-next-line no-control-regex -- the logger colors its console lines
        appendFileSync(file, `${new Date().toISOString()} ${String(chunk).replace(/\x1b\[[0-9;]*m/g, "")}`);
      } catch {
        // The log is a courtesy; never let it take the host down.
      }
      return write(chunk, ...rest);
    }) as typeof stream.write;
  }
}

// Boot breadcrumb (pre-bind). The installed boot is otherwise silent until the "Listening" line, so a
// launcher-killed slow/crashed boot leaves a 0-byte host.log that could mean five different things.
// This one line — version, pid, lane — lands in the SDK service log via the launcher's redirect
// and distinguishes "never started" from "started but died before bind". Plain console.log by design.
console.log(
  `pe-host boot v${resolveHostVersion()} pid=${process.pid} lane=${process.env.PE_LANE ?? "?"}`,
);

NodeRuntime.runMain(hostProgram());

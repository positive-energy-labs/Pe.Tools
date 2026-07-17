import "./ensure-source-lane.ts"; // MUST be first: sets PE_LANE=dev for source runs before load
import { NodeRuntime } from "@effect/platform-node";
import { hostProgram } from "./host-program.ts";
import { resolveHostVersion } from "./host-lifecycle.ts";
import { retireLegacyHosts } from "./retire-legacy-host.ts";

// Boot breadcrumb (pre-bind). The installed boot is otherwise silent until the "Listening" line, so a
// launcher-killed slow/crashed boot leaves a 0-byte host.log that could mean five different things.
// This one line — version, pid, lane — lands in the SDK service log via the launcher's redirect
// and distinguishes "never started" from "started but died before bind". Plain console.log by design.
console.log(
  `pe-host boot v${resolveHostVersion()} pid=${process.pid} lane=${process.env.PE_LANE ?? "?"}`,
);

NodeRuntime.runMain(hostProgram({ beforeHost: retireLegacyHosts }));

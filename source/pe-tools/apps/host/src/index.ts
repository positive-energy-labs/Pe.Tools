import "./ensure-source-lane.ts"; // MUST be first: sets PE_LANE=dev for source runs before load
import { NodeRuntime } from "@effect/platform-node";
import { hostProgram } from "./host-program.ts";
import { retireLegacyHosts } from "./retire-legacy-host.ts";

NodeRuntime.runMain(hostProgram(retireLegacyHosts));

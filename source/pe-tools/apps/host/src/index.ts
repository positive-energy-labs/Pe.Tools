import { NodeRuntime } from "@effect/platform-node";
import { hostProgram } from "./host-program.ts";

NodeRuntime.runMain(hostProgram);

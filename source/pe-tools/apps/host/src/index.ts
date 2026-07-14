import "./ensure-source-lane.ts"; // MUST be first: sets PE_LANE=dev for source runs before load
import { Effect } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { hostProgram } from "./host-program.ts";

NodeRuntime.runMain(hostProgram(Effect.void));

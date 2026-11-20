import { TakeoffCaptures } from "./takeoff-captures.ts";

// What is left for G3: the capture class, its header and the ribbon command name.
export const gateway = {
  Captures: TakeoffCaptures,
  ribbonTelemetry: ["CmdTakeoffsWeb"],
  captureHeader: "x-pe-takeoff-capture-id",
};

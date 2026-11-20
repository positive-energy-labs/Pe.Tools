import type { NativeProgress } from "@pe/agent-contracts";

export const phaseLabel: Record<NativeProgress["phase"], string> = {
  Prepare: "Reading model geometry",
  Capture: "Finding walls and openings",
  Designation: "Identifying zones",
  Solve: "Finding rooms",
  Materialization: "Drawing room outlines",
  Commit: "Applying changes",
};

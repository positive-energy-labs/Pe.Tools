import { keptStateKind } from "@pe/host-contracts/kinds";
import { z } from "zod";

/** Native evidence and host output share this tree and preserve prior bytes on replacement. */
export const runFileKind = keptStateKind({
  schema: z.unknown(),
  quiet: true,
  place: (_run: string, _parts: readonly string[]) => "Run output",
  segments: (run: string, parts: readonly string[]) => [run, ...parts],
});

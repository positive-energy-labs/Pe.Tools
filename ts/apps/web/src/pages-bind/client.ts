import { z } from "zod";
import type { PageTargetReading } from "@pe/agent-contracts";
import { requestJson } from "#/shell/readings-api";

/** Chrome's binding chip shares the kernel read door with the graph source. */
export const readPageTarget = (slug: string, signal = new AbortController().signal) =>
  requestJson(
    { path: `/pages/${encodeURIComponent(slug)}/target` },
    z.custom<PageTargetReading>(),
    signal,
  );

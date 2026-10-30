import { z } from "zod";
import { captureListSchema } from "@pe/agent-contracts";
import { readTable } from "../../../../packages/mcps/src/shared/query-client";
import { requestJson } from "#/shell/readings-api";

export const captureQueries = readTable({ "captures.list": { input: z.object({}) } }, async () =>
  (
    await requestJson(
      { path: "/captures", headers: { accept: "application/json" } },
      captureListSchema,
      new AbortController().signal,
    )
  ).captures.sort((a, b) => b.at.localeCompare(a.at)),
);

import { z } from "zod";

import { readTable } from "../../../../packages/mcps/src/shared/query-client";
import { callCompose } from "#/shell/readings-api";

export const captureQueries = readTable({ "captures.list": { input: z.object({}) } }, async () =>
  (await callCompose({ signal: new AbortController().signal }, "captures.list", {})).captures.sort(
    (a, b) => b.at.localeCompare(a.at),
  ),
);

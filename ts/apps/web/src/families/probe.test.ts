import { test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { familiesRouteState, familiesObservationSchema } from "@pe/agent-contracts";
import { familiesValue } from "./host.ts";
test("probe", () => {
  const raw = JSON.parse(readFileSync("C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/runs/kernel-crusade-20261110/drive/gate-ef940d365e4b22d03e2acff2fdefdf885f30075d/ev/families-capture.json", "utf8"));
  const observation = familiesObservationSchema.parse(raw);
  const work = familiesRouteState.schema.parse({});
  const catalog = { summary: { totalFamilies: 0, placedFamilies: 0, unplacedFamilies: 0, totalTypes: 0, totalPlacedInstances: 0, truncated: false }, families: [], issues: [] };
  const value = familiesValue({ work, catalog, observation, receipts: [] });
  const parts = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, JSON.stringify(v ?? null).length]));
  require("node:fs").writeFileSync("C:/Users/kaitp/AppData/Local/Temp/claude/9cf3f84969e43292/5968afdb-e491-4022-bd90-28e2f434840d/scratchpad/probe.out", ["PROBE", JSON.stringify(value).length, JSON.stringify(parts), "rows", value.rows.length, "params", value.params.length].join(" "));
});

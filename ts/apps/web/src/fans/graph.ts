import { ductsGraph } from "../ducts/graph";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { z } from "zod";
import type { FanPort } from "../ducts/sheet/model";
import { stableFanKey } from "../ducts/sheet/model";
export const fansGraph = {
  ...ductsGraph,
  workRoute: "ducts",
  key: "fans",
  address: "fans" as const,
  name: "Fans",
  directory: {
    ...ductsGraph.directory!,
    path: "/fans" as const,
    title: "Fans",
    label: "Fan air paths",
    aliases: ["fan", "ESP", "air path"],
  },
  subject: (page: import("../ducts/graph").DuctsPage) =>
    `Fans ${page.fan === "all" ? "all" : page.fan.join(" + ")}`,
  subjectField: {
    field: "fan" as const,
    noun: "fan",
    keyKind: "fan-mark" as const,
    cardinality: "many" as const,
    roster: "fans",
    detail: "sheet",
    pane: "sheet-roster",
    show: (id: string) => id,
  },
  fields: {
    ...ductsGraph.fields,
    stage: {
      ...field(z.enum(["sheet"]).default("sheet"), { url: "push" }),
      role: "stage" as const,
    },
    system: { ...ductsGraph.fields.system, role: "query" as const, editor: "pane" as const },
    fan: {
      ...ductsGraph.fields.fan,
      role: "subject" as const,
      editor: "pane" as const,
      picker: {
        reading: "fans",
        placeholder: "choose fans",
        options: (value: unknown) =>
          ((value as { rows: FanPort[] } | null)?.rows ?? []).map((row) => ({
            id: stableFanKey(row),
            label: `${row.mark} / port ${row.portIndex}`,
          })),
      },
    },
  },
  seeds: Object.fromEntries(
    Object.entries(ductsGraph.seeds ?? {}).map(([id, seed]) => [
      id,
      {
        ...seed,
        load: async () => {
          const loaded = await seed.load();
          return { ...loaded, page: { ...loaded.page, stage: "sheet" as const } };
        },
      },
    ]),
  ),
  stages: {
    sheet: {
      word: "Fan paths",
      panes: ["sheet-roster", "sheet-inputs", "sheet-picture", "sheet-ledger"],
      // Each apply previews first (its `prepare` runs the preview command and shows it as the
      // review), so the standalone previews stay row/Pea verbs; refresh is the pane head's.
      verbs: ["price", "heal", "assign-fan"],
    },
  },
  stageOrder: ["sheet"],
};

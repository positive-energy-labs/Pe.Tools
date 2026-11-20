import { result } from "./duct-loss-read.ts";
import type { SettingTierRead } from "@pe/agent-contracts/tiered-setting";
import { z } from "zod";
import { documentRefSchema } from "@pe/agent-contracts/target";
import { contract } from "@pe/agent-contracts/handle";
import {
  cell,
  documentRecord,
  entity,
  familyParameter,
  homeFile,
  productRead,
  ownerBlob,
  product as define,
  revitEntity,
  sheetCells,
} from "@pe/agent-contracts/product";
import { settingLayer, type Domain } from "@pe/agent-contracts/slots/sheet";
import { ductCatalogReadingSchema } from "./duct-catalog.ts";
import { peaGuide } from "./pea-guide.ts";
import { DUCTS_REFRESH_HEADER, snapshotReading, tablesReading } from "./reading.ts";
import {
  DUCT_PARAMETER_KEYS,
  ductParameterNameSchema,
  DUCTS_CRITERIA_CELLS,
  DUCTS_DEFAULT_CRITERIA,
  type DuctsCriteriaCell,
} from "./duct-inputs.ts";
import { criterionLabel } from "./criterion-words.neutral.ts";

export const ENGINE_DEFAULT_NO_SHARED_ROOT =
  "Engine default: no firm home, so the /ducts firm file (Settings/ducts.json) is not read";
const layerLabel = ([key, side]: (typeof DUCTS_CRITERIA_CELLS)[DuctsCriteriaCell]["layer"]) => {
  return side ? `${criterionLabel(key)} ${side}` : criterionLabel(key);
};
export const criterionCellLabel = (cell: DuctsCriteriaCell) =>
  layerLabel(DUCTS_CRITERIA_CELLS[cell].layer);
const entry = (
  name: string,
  path: readonly string[],
  domain: Domain,
  label: string,
  fallback?: unknown,
) =>
  [
    `setting.ducts.${name}`,
    { path, cell: cell(domain, "route", { label, default: fallback }) },
  ] as const;

const settings = Object.fromEntries([
  ...Object.entries(DUCTS_CRITERIA_CELLS).map(([name, { layer, domain }]) => {
    const [key, side] = layer;
    const base = DUCTS_DEFAULT_CRITERIA[key];
    return entry(
      name,
      ["criteria", ...layer],
      domain,
      layerLabel(layer),
      typeof base === "object" ? (side ? base[side] : undefined) : base,
    );
  }),
  ...DUCT_PARAMETER_KEYS.map((key) =>
    entry(
      `parameters.${key}`,
      ["parameters", key],
      { kind: "text", shape: ductParameterNameSchema(key) },
      key === "requiredEsp" ? "requiredEsp slot (empty writes nowhere)" : `${key} slot`,
    ),
  ),
  entry(
    "designFriction",
    ["designFriction"],
    { kind: "number", exclusiveMin: 0, unit: "in-wg/100 ft", digits: 3 },
    "Design friction",
    0.08,
  ),
]);
const settingsHome = homeFile(
  "ducts",
  ["project", "firm"],
  Object.fromEntries(Object.entries(settings).map(([name, { path }]) => [name, path])),
);
const settingsCells = Object.fromEntries(
  Object.entries(settings).map(([name, { cell }]) => [name, cell]),
);

export const losses = documentRecord(ownerBlob("ductLosses"));
export const lossWrites = {
  losses,
  fittingResults: revitEntity(entity("ductLossResults")),
  specificCoefficient: revitEntity(entity("specificCoefficient")),
  specificLoss: revitEntity(entity("specificLoss")),
  requiredEsp: familyParameter("requiredEsp"),
  fanFlow: familyParameter("fanFlow"),
  terminalFlow: familyParameter("terminalFlow"),
  terminalDrop: familyParameter("terminalDrop"),
};
const snapshotOps = ["ducts.snapshot.walk", "ducts.snapshot.roster", "ducts.tables"] as const;
export const lossSheetNative = {
  plan: [...snapshotOps, "ducts.apply.plan"],
  apply: [...snapshotOps, "ducts.apply"],
} as const;
export const product = define({
  id: "ducts",
  publishTool: false,
  says: "Shared duct model inputs, settings, catalogs and loss records.",
  homes: { settings: settingsHome, ...lossWrites, catalogs: productRead(homeFile("Catalogs")) },
  cells: settingsCells,
  routes: {},
  readings: {
    ductLoss: { handle: result, sources: [] },
    snapshot: {
      handle: snapshotReading,
      sources: ["losses", "settings"],
      load: {
        resource: true,
        scope: "document",
        fixes: { "ducts.snapshot.roster": { selector: { kind: "roster" } } },
        basisHeaders: { refresh: DUCTS_REFRESH_HEADER },
        calls: {
          "ducts.snapshot.roster": { canonicalSession: true, reading: "roster" },
          "ducts.snapshot.walk": { canonicalSession: true, reading: "walk" },
        },
      },
    },
    tables: {
      handle: tablesReading,
      sources: [],
      load: {
        resource: true,
        scope: "session",
        calls: {
          "ducts.tables": { canonicalSession: true, reading: "tables" },
        },
      },
    },
    catalogs: {
      handle: contract("ducts.catalogs", {
        input: z.strictObject({ target: documentRefSchema.nullable().default(null) }),
        data: ductCatalogReadingSchema,
        uses: [],
        subject: "None",
      }),
      sources: ["catalogs"],
      says: "Read duct pricing tables and their source files across the user, project and firm homes.",
    },
  },
  commands: {},
  guide: peaGuide,
});

type SettingsRead = { settings?: Record<string, readonly SettingTierRead[]> } | null;
export const ductsSettings = Object.fromEntries(
  Object.entries(sheetCells(product)).flatMap(([name, binding]) => {
    const { home } = binding;
    return home.at === "setting"
      ? [
          [
            name,
            {
              ...binding,
              home,
              per: "route" as const,
              model: (read: SettingsRead) => settingLayer(binding, read?.settings?.[home.owner]),
            },
          ],
        ]
      : [];
  }),
);

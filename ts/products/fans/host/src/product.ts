import { product } from "@pe/fans-contract/product";
import { implement } from "@pe/host-internal/product";
import { fanLosses } from "./actions.ts";
import type { DuctActionDependencies } from "@pe/ducts-host/action-runtime";
import {
  ductCalc,
  fanCalcBreakdown,
  fanPressureRows,
  fanRoster,
  networkCalcsBody,
} from "./fan-calc.ts";
import { fansCalc } from "./host.ts";
import { catalogsHome } from "@pe/ducts-host/duct-catalogs";

export const host = implement<typeof product, DuctActionDependencies>(product, {
  homes: { catalogs: catalogsHome },
  readings: {
    calc: fansCalc,
    roster: fanRoster,
    overview: fanPressureRows,
    calcDetail: ductCalc,
    calcBreakdown: fanCalcBreakdown,
    networkCalcs: networkCalcsBody,
  },
  commands: {
    "sheet.plan": fanLosses("sheet.plan", "plan"),
    "sheet.apply": fanLosses("sheet.apply", "apply"),
  },
});

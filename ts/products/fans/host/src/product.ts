import { product } from "@pe/fans-contract/product";
import { implement } from "@pe/host-internal/product";
import { fansExecutors } from "./actions.ts";
import {
  ductCalc,
  fanCalcBreakdown,
  fanPressureRows,
  fanRoster,
  networkCalcsBody,
} from "./fan-calc.ts";
import { fansCalc } from "./host.ts";

const { reads } = implement(product, {
  readings: {
    calc: fansCalc,
    roster: fanRoster,
    overview: fanPressureRows,
    calcDetail: ductCalc,
    calcBreakdown: fanCalcBreakdown,
    networkCalcs: networkCalcsBody,
  },
  commands: {
    "sheet.plan": (bridge, deps) => fansExecutors(bridge, deps)["sheet.plan"],
    "sheet.apply": (bridge, deps) => fansExecutors(bridge, deps)["sheet.apply"],
  },
});
export const host = { product, reads, sheet: fansExecutors };

import { product } from "@pe/duct-systems-contract/product";
import {
  ductsRefresh,
  ductsRulings,
  type DuctActionDependencies,
} from "@pe/ducts-host/action-runtime";
import { implement } from "@pe/host-internal/product";
import { assignFan, heal } from "./actions.ts";
import { reads } from "./host.ts";
import { catalogsHome } from "@pe/ducts-host/duct-catalogs";

export const host = implement<typeof product, DuctActionDependencies>(product, {
  homes: { catalogs: catalogsHome },
  readings: reads,
  commands: {
    "ducts.refresh": ductsRefresh,
    "ducts.plan-heal": heal("ducts.plan-heal", "seal"),
    "ducts.apply-heal": heal("ducts.apply-heal", "apply"),
    "ducts.rehearse-heal": heal("ducts.rehearse-heal", "rehearse"),
    "ducts.plan-assign-fan": assignFan("ducts.plan-assign-fan", "seal"),
    "ducts.apply-assign-fan": assignFan("ducts.apply-assign-fan", "apply"),
    "ducts.rehearse-assign-fan": assignFan("ducts.rehearse-assign-fan", "rehearse"),
    "sheet.plan": ductsRulings("sheet.plan", "plan"),
    "sheet.apply": ductsRulings("sheet.apply", "apply"),
  },
});

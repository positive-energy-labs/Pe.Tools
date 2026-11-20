import type { DuctsCriteriaCell } from "@pe/ducts-contract/duct-inputs";
import type { product } from "../product.ts";

type WorkCell =
  | DuctsCriteriaCell
  | "writeIntent"
  | "assumptions"
  | "rules"
  | "catalogs"
  | "ruleAssignments"
  | "subject"
  | "labelParameter"
  | "workingPhase"
  | "systemColours"
  | "kinds";

type AssertNever<T extends never> = T;
type Declared = keyof typeof product.work.schema.shape;
export type MissingWorkCells = AssertNever<Exclude<WorkCell, Declared>>;
export type UnexpectedWorkCells = AssertNever<Exclude<Declared, WorkCell>>;

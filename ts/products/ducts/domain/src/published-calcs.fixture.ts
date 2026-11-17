import { createHash } from "node:crypto";
import { z } from "zod";
import { ductsPricingData } from "@pe/agent-contracts";
import { fansCalcData } from "@pe/fans-contract/fans-read";
import saved from "./fixtures/published-calcs.fixture.json" with { type: "json" };

const cases = z.record(z.string(), z.unknown()).parse(saved);
const calc = ductsPricingData.shape.calcs.element;
const encode = (value: unknown) => JSON.stringify(value, (_key, value) =>
  value instanceof Map ? { $map: [...value] } : value instanceof Set ? { $set: [...value] } : value);
function captured(kind: string, args: unknown[]) {
  const key = createHash("sha256").update(encode([kind, args])).digest("hex");
  if (!Object.hasOwn(cases, key)) throw Error(`No published ${kind} input fixture for ${key}`);
  return structuredClone(cases[key]);
}
/** Fixed peer inputs, decoded through the published contract; these tests never run the peer engine. */
export const publishedCalc = (...args: unknown[]) => calc.parse(captured("buildCalc", args));
export const publishedCalcs = (...args: unknown[]) => z.array(calc).parse(captured("networkCalcs", args));
export const publishedPricing = () => ductsPricingData.pick({ calcs: true, survey: true, analysis: true }).parse(cases.pricing);
export const publishedRoster = () => ductsPricingData.shape.analysis.shape.systems.parse(cases.roster);
export const publishedCalcView = () => fansCalcData.shape.calcView.parse(cases.calcView);
export const publishedCalcExample = () => calc.parse(Object.values(cases).find(value =>
  typeof value === "object" && value !== null && "fan" in value));

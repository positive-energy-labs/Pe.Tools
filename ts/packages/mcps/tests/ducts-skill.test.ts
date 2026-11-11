import { ductsSheetRequestSchema } from "@pe/agent-contracts";
import { renderDuctsSkill } from "../src/pea/ducts-skill.ts";
import { expect, test } from "vite-plus/test";

test("the fan and asserted-chain requests have one discriminated contract", () => {
  const target = { session: "dev", openId: "project" };
  expect(
    ductsSheetRequestSchema.safeParse({ target, mode: "fan", unitId: 14577391, portIndex: 2 })
      .success,
  ).toBe(true);
  expect(
    ductsSheetRequestSchema.safeParse({
      target,
      mode: "chain",
      start: { elementId: 1 },
      end: { elementId: 2 },
      direction: "return",
    }).success,
  ).toBe(true);
  expect(
    ductsSheetRequestSchema.safeParse({
      target,
      mode: "chain",
      start: { elementId: 1 },
      end: { elementId: 2 },
    }).success,
  ).toBe(false);
});

test("the ducts skill triggers on airflow and connectivity questions, not only pressure drop", () => {
  const text = renderDuctsSkill();
  const description = /^description: (.*)$/m.exec(text)![1]!;
  for (const phrase of ["airflow", "connects or ties into", "ERV", "fan coil", "static pressure"]) {
    expect(description).toContain(phrase);
  }
  expect(text).toContain("Never answer them from a script over connector Direction");
  expect(text).toContain("what each component on the walked path does to the air");
  expect(text).toContain("the project cut sheet or submittal first, then a schedule, then the vendor's site");
  expect(text).toContain("read_document, image: true and a crop");
  expect(text).toContain("fill it yourself through the Ducts tool's Work with the source cited");
});

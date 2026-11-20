import { FAN_CALC_GUIDE, ductsRosterRequestSchema, ductsCalcRequestSchema } from "../calc-read.ts";
import { createPeCatalog } from "@pe/agent-contracts/pe-api";
import { builtinHostActions as hostActions } from "@pe/agent-contracts/semantic-actions";
import { fansReadDiscovery } from "../read-discovery.ts";
import { renderDuctsSkill } from "../pea/ducts-skill.ts";
import { expect, test } from "vite-plus/test";

test("the fan and asserted-chain requests have one discriminated contract", () => {
  const target = { session: "dev", openId: "project" };
  expect(
    ductsCalcRequestSchema.safeParse({ target, mode: "fan", unitId: 14577391, portIndex: 2 })
      .success,
  ).toBe(true);
  expect(
    ductsCalcRequestSchema.safeParse({
      target,
      mode: "chain",
      start: { elementId: 1 },
      end: { elementId: 2 },
      direction: "return",
    }).success,
  ).toBe(true);
  expect(
    ductsCalcRequestSchema.safeParse({
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
  expect(text).toContain(
    "the project cut sheet or submittal first, then a schedule, then the vendor's site",
  );
  expect(text).toContain("read_document, image: true and a crop");
  expect(text).toContain(
    "fill it yourself through the owning Fans or Duct Systems tool's Work with the source cited",
  );
  for (const step of [
    "Locate the project folder",
    "Inventory the project folder",
    "Rank the sources",
    "Find the design basis",
    "fetch the manufacturer's published data yourself",
    "the text layer reports a struck row as live",
    "Report one row per component on the walked path",
    "A cell may stay blank only after you ran a WebSearch",
  ]) {
    expect(text).toContain(step);
  }
});

test("the fan read takes no edits or proposal, and the guide claims no write through it", () => {
  const target = { session: "dev", openId: "project" };
  const fan = { target, mode: "fan", unitId: 14577391, portIndex: 2 };
  for (const dead of [{ edits: {} }, { proposal: { pair: ["1:0", "2:0"], verdict: "accept" } }])
    expect(ductsCalcRequestSchema.safeParse({ ...fan, ...dead }).success).toBe(false);
  const guide = JSON.stringify(FAN_CALC_GUIDE);
  expect(guide).not.toMatch(/proposal \{pair|This writes a join ruling/);
  expect(guide).toContain("The calc read takes no edits and writes nothing");
});

test("Pea is shown the roster's by-mark lookup in the reads.value input schema", () => {
  const target = { session: "dev", openId: "project" };
  expect(ductsRosterRequestSchema.safeParse({ target }).success).toBe(true);
  expect(ductsRosterRequestSchema.safeParse({ target, mark: "MA-1" }).success).toBe(true);
  const { peRoutes } = createPeCatalog(hostActions, fansReadDiscovery);
  const input = JSON.stringify(peRoutes["reads.value"].catalog.discovery?.input);
  for (const shown of ['"const":"fans.roster"', '"mark"', '"const":"fans.calc-detail"', '"unitId"'])
    expect(input).toContain(shown);
  expect(input).not.toContain('"proposal"');
  expect(FAN_CALC_GUIDE.walk[0]).toContain("{target: {session, openId}, mark}");
});

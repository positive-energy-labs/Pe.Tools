import { expect, test } from "vite-plus/test";
import { bundledPeaSkills, peaProductToolMetadata } from "@pe/mcps";
import {
  peaAgentInstructions,
  peaAgentInstructionsFor,
  peaNativeToolCategories,
  resolvePeaToolCategory,
} from "../src/pea-runtime.ts";

const revitToolNames = Object.entries(peaProductToolMetadata)
  .filter(([, meta]) => meta.requiresRevit)
  .map(([name]) => name);

test("kernel names no Revit-only tool when Revit is absent", () => {
  const kernel = peaAgentInstructionsFor({ revit: false });
  expect(kernel).toBe(peaAgentInstructions);
  for (const name of revitToolNames) expect(kernel).not.toContain(name);
  expect(kernel).not.toMatch(/subagent|forked/i);
  expect(kernel).not.toContain("~/Documents");
});

test("kernel names only the three doors; the Revit line is appended only with Revit", () => {
  for (const door of ["pe_find", "pe_read", "pe_do", "scope_set"])
    expect(peaAgentInstructions).toContain(door);
  expect(peaAgentInstructions).not.toContain("capture_view");
  const kernel = peaAgentInstructionsFor({ revit: true });
  expect(kernel.startsWith(peaAgentInstructions)).toBe(true);
  expect(kernel).toContain("capture_view");
  expect(kernel).toContain("op:scripting.execute");
});

test("kernel documents the controller's actual while-active wire", () => {
  expect(peaAgentInstructions).toContain('<user delivery="while-active">');
  expect(peaAgentInstructions).not.toContain("<user-message");
});

test("every provider-visible native workspace and skill tool has an intentional category", () => {
  for (const [name, category] of Object.entries(peaNativeToolCategories)) {
    expect(category).not.toBe("other");
    expect(resolvePeaToolCategory(name)).toBe(category);
  }
  expect(resolvePeaToolCategory("mastra_workspace_not_a_tool")).toBe("other");
  for (const [name, meta] of Object.entries(peaProductToolMetadata)) {
    expect(resolvePeaToolCategory(name)).toBe(meta.category);
  }
});

test("bundled skills are unique, parseable, and carry a trigger", () => {
  const names = bundledPeaSkills.map((skill) => skill.name);
  expect(new Set(names).size).toBe(names.length);
  for (const skill of bundledPeaSkills) {
    const description = /^description:\s*(.+)$/m.exec(skill.content)?.[1] ?? "";
    expect(skill.content.startsWith(`---\nname: ${skill.name}\n`)).toBe(true);
    // gray-matter drops a skill whose description contains `: "` (AGENTS.md footgun).
    expect(description).not.toContain(': "');
    expect(description).toMatch(/\bUse (when|for|after|before|at)\b/);
  }
});

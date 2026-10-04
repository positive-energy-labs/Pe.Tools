import { expect, test } from "vite-plus/test";
import { bundledPeaSkills } from "../src/pea/skills.ts";
import { peaAgentInstructions, peaAgentInstructionsFor } from "../src/pea/instructions.ts";

const revitToolNames = ["capture_view"];

test("kernel names no Revit-only tool when Revit is absent", () => {
  const kernel = peaAgentInstructionsFor({ revit: false });
  expect(kernel).toBe(peaAgentInstructions);
  for (const name of revitToolNames) expect(kernel).not.toContain(name);
  expect(kernel).not.toMatch(/subagent|forked/i);
  expect(kernel).not.toContain("~/Documents");
});

test("kernel names only the three doors; the Revit line is appended only with Revit", () => {
  for (const door of ["pe_find", "pe_read", "pe_do", "target_set"])
    expect(peaAgentInstructions).toContain(door);
  expect(peaAgentInstructions).not.toContain("capture_view");
  const kernel = peaAgentInstructionsFor({ revit: true });
  expect(kernel.startsWith(peaAgentInstructions)).toBe(true);
  expect(kernel).toContain("capture_view");
  expect(kernel).toContain("op:scripting.execute");
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

test("kernel sends diagrams through the diagram tool, never through mermaid fences", () => {
  expect(peaAgentInstructions).toMatch(/draw diagrams with the diagram tool/i);
  expect(peaAgentInstructions).toMatch(/never write mermaid fences/i);
});

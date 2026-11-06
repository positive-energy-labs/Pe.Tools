import { readFileSync } from "node:fs";
import { expect, test, vi } from "vite-plus/test";
import * as THREE from "three";
import { attentionColours, attentionMark } from "./attention";
import { createOutline } from "./outline";

const { readInk } = vi.hoisted(() => ({ readInk: vi.fn() }));
vi.mock("./ink", () => ({ inkOf: readInk }));

test("picture fill and outline consume the kit's select, hover and indirect ladder", () => {
  const css = readFileSync(new URL("../../../../packages/kit/src/base.css", import.meta.url), "utf8");
  // Assert the actual kit contract rather than maintaining picture-local ratios or colours.
  expect(css).toMatch(/--pe-hover: color-mix\(in srgb, var\(--pe-select\) 65%, var\(--pe-page\)\)/);
  expect(css).toMatch(/--pe-indirect: color-mix\(in srgb, var\(--pe-select\) 30%, var\(--pe-page\)\)/);
  for (const theme of ["light", "dark"]) {
    const values = Object.fromEntries(["select", "hover", "indirect"].map((role, i) =>
      [role, new THREE.Color().setHSL(i / 3, 0.5, theme === "light" ? 0.7 : 0.3)]));
    readInk.mockImplementation((role: string) => values[role]);
    const mount = {} as Element;
    const colours = attentionColours(mount);
    expect(colours).toEqual({ selected: values.select, hover: values.hover, lit: values.indirect });
    for (const role of ["select", "hover", "indirect"]) expect(readInk).toHaveBeenCalledWith(role, mount);
    const outline = createOutline({} as THREE.WebGLRenderer, colours, new THREE.Color());
    outline.setColours(colours);
    outline.dispose();
  }
});

test("renderer applies kit colours to faces and outline channels without a local lift", () => {
  const renderer = readFileSync(new URL("./renderer.ts", import.meta.url), "utf8");
  expect(renderer).toContain("if (mark) color.copy(attention[mark])");
  expect(renderer).toContain("attentionMark(!!selected?.has(key), key === hoveredElement, !!lit?.has(key))");
  expect(renderer).not.toContain("liftLightness");
  const outline = readFileSync(new URL("./outline.ts", import.meta.url), "utf8");
  expect(outline).toContain("line.r > 0.0 ? selectedInk : line.b > 0.0 ? hoverInk : indirectInk");
  for (const [uniform, role] of [["selectedInk", "selected"], ["hoverInk", "hover"], ["indirectInk", "lit"]])
    expect(outline).toContain(`${uniform}: { value: colours.${role}.clone() }`);
});

test("selection wins every overlap, then direct hover, then indirect reach", () => {
  for (const selected of [false, true])
    for (const hover of [false, true])
      for (const lit of [false, true])
        expect(attentionMark(selected, hover, lit)).toBe(
          selected ? "selected" : hover ? "hover" : lit ? "lit" : null,
        );
});

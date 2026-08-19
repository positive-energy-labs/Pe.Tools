// @vitest-environment jsdom
/**
 * PROTOTYPE — the mount smoke check.
 *
 * The three paradigms are judged by eye, and no browser tool was available in the session that
 * built them. This is the honest floor under that gap: each one MOUNTS on the real fixture and
 * puts its own claim on the page. It is not a paint proof and does not pretend to be one — it
 * catches a render-time throw, which is the one failure a type-check cannot see.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ParadigmA } from "./a.tsx";
import { ParadigmB } from "./b.tsx";
import { ParadigmC } from "./c.tsx";
import { showcaseModel } from "./model.ts";
import { StatePanel, type Editor } from "./shell.tsx";

afterEach(cleanup);

/** The real edit channel minus React state — the paradigms only read it during a mount. */
const editor: Editor = {
  model: showcaseModel(),
  typeName: "Standard",
  setTypeName: () => {},
  apply: () => {},
  touched: [],
  reset: () => {},
};

describe("proto-editor · mounts on the real fixture", () => {
  it("A shows both directions off the plane it opens on", () => {
    render(<ParadigmA editor={editor} />);
    expect(screen.getByText(/defined from/)).toBeTruthy();
    expect(screen.getByText(/defined off it — 1 dependent/)).toBeTruthy();
  });

  it("B draws both views and labels the parts it can be clicked on", () => {
    render(<ParadigmB editor={editor} />);
    expect(screen.getByLabelText(/plan · looking down/)).toBeTruthy();
    // Once per view — the same part is clickable in plan and in front.
    expect(screen.getAllByLabelText("solid body")).toHaveLength(2);
    expect(screen.getAllByLabelText("connector supply-air")).toHaveLength(2);
  });

  it("C writes one sentence per construct", () => {
    render(<ParadigmC editor={editor} />);
    expect(screen.getAllByText("sits where")).toHaveLength(4); // the four frames
    expect(screen.getByText("author solid")).toBeTruthy();
  });

  it("the state panel reports an unedited document as unedited", () => {
    render(<StatePanel editor={editor} />);
    expect(screen.getByText(/nothing edited yet/)).toBeTruthy();
  });
});

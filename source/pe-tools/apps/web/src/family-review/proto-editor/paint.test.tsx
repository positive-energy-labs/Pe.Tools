// @vitest-environment jsdom
/** The composed winner mounts on the real fixture; this is a render check, not a paint proof. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ParadigmD } from "./composed.tsx";
import { showcaseModel } from "./model.ts";
import { StatePanel, type Editor } from "./shell.tsx";

afterEach(cleanup);

/** The real edit channel minus React state — the paradigms only read it during a mount. */
const model = showcaseModel();
const editor: Editor = {
  model,
  baseline: model,
  typeName: "Standard",
  setTypeName: () => {},
  apply: () => {},
  touched: [],
  reset: () => {},
  write: () => {},
  focus: null,
  setFocus: () => {},
};

describe("proto-editor · mounts the composed winner", () => {
  it("the state panel reads the diff as the PENDING WRITE, empty when it equals the json", () => {
    render(<StatePanel editor={editor} />);
    expect(screen.getByText(/nothing to write/)).toBeTruthy();
    expect(screen.getByText("write to family.json")).toBeTruthy();
  });

  it("composes all four surfaces on one page and names its one write target", () => {
    render(<ParadigmD editor={editor} />);
    expect(screen.getByText("parameters")).toBeTruthy(); // the hybrid grid
    expect(screen.getAllByLabelText(/plan view/)).toHaveLength(1); // the triptych, as a view
    expect(screen.getByText("its inputs")).toBeTruthy(); // the sidebar
    expect(screen.getByText("author solid")).toBeTruthy(); // sentences, still authoring
    expect(screen.getByLabelText("raw family.json")).toBeTruthy(); // the synced pane
    expect(screen.getByText(/writes to/)).toBeTruthy();
    expect(screen.getByText("seam · materialize into Revit")).toBeTruthy();
  });
});

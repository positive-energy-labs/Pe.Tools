// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { findingsCommands, findingsWorkSchema, type Finding } from "@pe/agent-contracts/slots";
import { subjectCode } from "@pe/agent-contracts/subject-ref";
import { Notes } from "./notes.tsx";
import { ElementMenu } from "../../../revit/element-menu.tsx";
import type { ComponentProps } from "react";
afterEach(cleanup);
const type = subjectCode({ keyKind: "name", key: ["Fam", "Type"] });

test("a type with no picture offers Findings; a person's note survives remount with its words, author and time", async () => {
  let saved = "";
  const findings = (): Finding[] => Object.values(findingsWorkSchema.parse(saved ? JSON.parse(saved) : {}).findings);
  const mount: ComponentProps<typeof Notes>["mount"] = {
    spec: { key: "families" }, findings, value: () => ({ state: "ready", value: {}, publication: null }),
    kernelVerb: key => ({ label: key, effect: "WorkWrite", pending: false, refusal: null, failure: null,
      run: async input => {
        expect(key).toBe("findings.say");
        const note = findingsWorkSchema.parse({ findings: { n1: { ...findingsCommands["findings.say"].input.parse(input), id: "n1", said: { by: "person", at: "2026-11-13T12:00:00Z" } } } });
        saved = JSON.stringify(note);
      } }),
  };
  const Page = () => <div data-findings-route="families"><ElementMenu /><Notes mount={mount} /><span data-subject={type}>Type</span></div>;
  const first = render(<Page />);
  fireEvent.contextMenu(screen.getByText("Type"));
  fireEvent.click(await screen.findByRole("option", { name: "Findings" }));
  await screen.findByRole("dialog");
  fireEvent.change(screen.getByLabelText("finding text"), { target: { value: "Check the clearance" } });
  fireEvent.click(screen.getByRole("button", { name: "Write finding" }));
  await waitFor(() => expect(saved).toContain("Check the clearance"));
  first.unmount();
  render(<Page />);
  fireEvent.contextMenu(screen.getByText("Type"));
  fireEvent.click(await screen.findByRole("option", { name: "Findings" }));
  expect(await screen.findByText("Check the clearance")).toBeTruthy();
  expect(screen.getByText(/person/).textContent).toContain("2026-11-13T12:00:00Z");
});

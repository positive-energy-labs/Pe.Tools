// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createWitness } from "../fans/cutover.test-support.ts";
import { AdmittedSubjectPicker, subjectOf } from "./admitted-chrome.tsx";

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
});

test.each([
  ["owner", "mouse"],
  ["owner", "keyboard"],
  ["fans", "mouse"],
  ["fans", "keyboard"],
] as const)("header multi-picker opens a canonical %s subject by %s", async (name, input) => {
  const f = await createWitness(closes);
  const mount = f[name];
  const data = name === "owner" ? f.admitted.owner.data : f.admitted.presenter.data;
  await waitFor(() => expect(subjectOf(mount, data)?.options.length).toBeGreaterThan(0));
  const options = subjectOf(mount, data)?.options;
  const first = options?.[0];
  if (!first) throw Error("Need a canonical subject");
  render(<AdmittedSubjectPicker mount={mount} data={data} />);
  fireEvent.click(screen.getByRole("button", { name: `Choose ${data.subject.noun}` }));
  const option = await screen.findByRole("option", { name: first.label });
  if (input === "mouse") fireEvent.click(option);
  else {
    const search = screen.getByRole("combobox");
    fireEvent.change(search, { target: { value: first.label } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
  }
  expect(mount.page.read()[data.subject.field]).toEqual({ kind: "ids", ids: [first.id] });
});

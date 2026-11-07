// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createWitness } from "../fans/cutover.test-support.ts";
import { SubjectPicker as AdmittedSubjectPicker, subjectOf } from "./subject-picker";

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
  if (name === "fans") {
    const key = f.fans.workBasis()?.token.scope.identity.work;
    if (!key) throw Error("No accepted Work key");
    expect(
      await f.ws.apply(
        key,
        "fans",
        "human",
        [{ path: ["designFriction"], value: { edit: { value: 0.09 } } }],
        0,
      ),
    ).toMatchObject({ ok: true });
    await waitFor(() => expect(f.fans.work()?.revision).toBe(1));
  }
  render(<AdmittedSubjectPicker mount={mount} data={data} />);
  fireEvent.click(screen.getByRole("button", { name: `Choose ${data.subject!.noun}` }));
  const option = await screen.findByRole("option", { name: first.label });
  if (input === "mouse") fireEvent.click(option);
  else {
    const search = screen.getByRole("combobox");
    fireEvent.change(search, { target: { value: first.label } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
  }
  expect(name === "owner" ? f.owner.page.read().system : f.fans.page.read().fan).toEqual({
    kind: "ids",
    ids: [first.id],
  });
  if (name === "fans") {
    expect(f.fans.work()).toMatchObject({
      revision: 1,
      value: { designFriction: { edit: { value: 0.09 } } },
    });
    await waitFor(() => expect(f.fans.workBasis()).not.toBeNull());
    f.fans.invoke("edit", {
      patches: [{ path: ["designFriction"], value: { edit: { value: 0.1 } } }],
    });
    await waitFor(() =>
      expect(f.fans.work()).toMatchObject({
        revision: 2,
        value: { designFriction: { edit: { value: 0.1 } } },
      }),
    );
  }
});

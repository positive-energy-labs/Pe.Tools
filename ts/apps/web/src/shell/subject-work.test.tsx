// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { createWitness } from "../fans/cutover.test-support.ts";
import { subjectOf } from "./admitted-chrome.tsx";
const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);
test("subject transition retains edited Fans Work while the feed reacquires", async () => {
  const f = await createWitness(closes);
  await waitFor(() => expect(f.fans.work()).not.toBeNull());
  const basis = f.fans.workBasis();
  const key = basis?.token.scope.identity.work;
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
  const before = f.fans.work();
  const subjects = subjectOf(f.fans, f.admitted.presenter.data);
  const first = subjects?.options[0];
  if (!subjects || !first) throw Error("No fan roster");
  subjects.add([first.id]);
  expect(f.fans.work()).toEqual(before);
  await waitFor(() => expect(f.fans.work()).toEqual(before));
});

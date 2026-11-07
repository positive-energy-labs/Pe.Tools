// @vitest-environment jsdom
import { test, expect, afterEach } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { z } from "zod";
import { identityCodecs } from "./page-port";
import { localId } from "../ducts/identity";
import { subjectState } from "./subject";
import { tabTitle } from "../workbench/route-tabs";
import { admit } from "../fans/admission.fixture";
import { mountTypedRoute } from "../shell/typed-mount";
import { nativeTestAdapter } from "../fans/native.test-support";
import { createWorkFeedClient } from "./work-feed-client";
import { admittedRouterAddress } from "./typed-place-boundary";
import { placeInput } from "./typed-place.test-support";
const mounts: { dispose(): void }[] = [];
afterEach(() => mounts.splice(0).forEach((mount) => mount.dispose()));

test("admitted Fans uses its actual picker labels and decoded subject; foreign and retired Places cannot borrow them", async () => {
  const { presenter } = await admit();
  const history = createMemoryHistory({ initialEntries: ["/fans?fixture=layout"] });
  const input = placeInput(admittedRouterAddress(history));
  const mount = nativeTestAdapter(mountTypedRoute(presenter.typed,input,presenter.workFingerprint),createWorkFeedClient());
  mounts.push(mount);
  await waitFor(() => expect(mount.readingStatus("value").snapshot.current).toBe(true));
  const options = z
    .array(z.object({ id: z.unknown(), label: z.string() }))
    .parse(mount.picker("fan"));
  expect(options.length).toBeGreaterThan(1);
  const ids = options.map((option) => {
    const decoded = identityCodecs.local.decode(z.string().parse(option.id));
    if (!decoded.ok) throw Error(decoded.reason);
    return decoded.value;
  });
  const search = () => Object.fromEntries(new URLSearchParams(history.location.search));
  mount.controls.subject({ kind: "ids", ids: [ids[0]!] });
  expect(subjectState("fans", search())).toMatchObject({
    ready: true,
    refusal: null,
    label: options[0]!.label,
  });
  expect(
    tabTitle({
      id: "fans-place",
      route: "fans",
      link: history.location.href,
      at: "2026-11-05T00:00:00Z",
    }),
  ).toBe(`Fans \u00b7 ${options[0]!.label}`);
  const saved = subjectState("fans", search()).link!;
  expect(new URL(saved, "http://place.invalid").searchParams.get("fan")).toBe(
    history.location.search ? new URLSearchParams(history.location.search).get("fan") : null,
  );
  mount.controls.subject({ kind: "ids", ids: [ids[1]!] });
  await waitFor(() => expect(mount.subjectState(search())?.label).toBe(options[1]!.label));
  expect(mount.subjectState({ ...search(), fan: "{broken" })).toMatchObject({
    ready: false,
    refusal: expect.stringContaining("malformed"),
  });
  expect(
    mount.subjectState({
      ...search(),
      fan: JSON.stringify({ kind: "ids", ids: [localId("ducts-fan", "unknown-unit@0")] }),
    }),
  ).toMatchObject({ ready: false, refusal: expect.stringContaining("not in this model") });
  expect(mount.subjectState({ ...search(), target: "another-model" })).toBeNull();
  mount.release();
  expect(mount.subjectState(search())).toMatchObject({ ready: false, label: "" });
  mount.dispose();
  expect(mount.subjectState(search())).toMatchObject({ ready: false, label: "" });
  expect(subjectState("fans", search()).ready).toBe(false);
});

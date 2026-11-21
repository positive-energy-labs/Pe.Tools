// @vitest-environment jsdom
import { act, waitFor } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { product } from "@pe/duct-systems-contract/product";
import { systemCode } from "@pe/ducts-web/identity";
import { module, roster as systemRoster } from "../route.ts";
import {
  pin,
  recordedTables,
  roster,
  targetJourney,
  typedSubjectDoor,
} from "../../../../tests/e2e/mounted.test-support.tsx";

test("Duct Systems: reload and Forward restore the pair, while Back restores EX 60", async () => {
  const reads = Object.values(product.readings).map(({ handle }) => handle.key);
  const j = await targetJourney(
    module,
    reads,
    () => (key, input) => {
      if (key === "ducts.tables") return recordedTables();
      if (key === "ducts.snapshot.roster") return roster;
      if (key === "ducts.snapshot.walk") {
        const ids: number[] = input.selector?.systemIds ?? [];
        return { ...roster, systems: roster.systems.filter(({ id }) => ids.includes(id)) };
      }
      throw Error(`Unexpected native read ${key}`);
    },
    { open: ["chadds"], search: new URLSearchParams({ target: pin("chadds") }) },
  );
  const first = systemCode("EX 60");
  const second = systemCode("EX 59");
  const single = { kind: "ids", ids: [first] };
  const pair = { kind: "ids", ids: [first, second] };
  const address = () => JSON.parse(j.search().get("system") ?? "null");
  const read = async () => {
    const mount = await j.bound("chadds", false);
    return { address: address(), page: mount.page.read().system };
  };
  try {
    const mount = await j.bound("chadds", false);
    await waitFor(() => expect(mount.value(systemRoster).state).toBe("ready"), { timeout: 20000 });
    const door = typedSubjectDoor(mount)!;
    await act(() => door.select([first]));
    expect(address()).toEqual(single);
    await act(() => door.add([second]));
    expect(address()).toEqual(pair);

    await j.reload();
    const reload = await read();
    await j.back();
    const back = await read();
    await j.forward();
    const forward = await read();
    expect({ reload, back, forward }).toEqual({
      reload: { address: pair, page: pair },
      back: { address: single, page: single },
      forward: { address: pair, page: pair },
    });
    expect(j.search().get("target")).toBe(pin("chadds"));
  } finally {
    await j.close();
  }
});

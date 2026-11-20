// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { module as fans } from "@pe/fans-web/route";
import { mounted } from "../mounted.test-support.tsx";
import { switchDocument } from "../document-switch.test-support.tsx";

test("Fans: changing document clears an addressed fan", async () => {
  const fan = JSON.stringify({ kind: "ids", ids: ["UniqueId:fan-from-chadds"] });
  const a = await mounted(fans, [], () => null, { search: new URLSearchParams({ fan }) });
  try {
    expect(a.search().get("fan")).toBe(fan);
    const search = await switchDocument(fans.spec, a.search);
    expect(search.get("fan")).toBe(JSON.stringify({ kind: "ids", ids: [] }));
  } finally {
    await a.close();
  }
});

import { expect, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectFixture } from "./project-home-fixture.ts";
import { bindWork } from "@pe/agent-contracts";

test("schedule capture through /actions writes the target document's project Pod", async () => {
  const f = await projectFixture(false);
  const key = bindWork("schedules", null, undefined, f.target.ref);
  expect((await f.saved.start(key, {}, "human")).ok).toBe(true);
  const staged = await f.saved.apply(
    key,
    "schedules",
    "human",
    [
      {
        path: ["writeIntent", "schedule.capture", "edit"],
        value: {
          value: { pod: "project-only", scheduleId: 42, path: "settings/schedule/project.json" },
        },
      },
    ],
    (await f.saved.view(key, "schedules"))!.revision,
  );
  expect(staged, JSON.stringify(staged)).toMatchObject({ ok: true });
  const response = await f.post("/actions", {
    id: "project-schedule",
    key: "schedule.capture",
    target: f.target,
    input: { work: { key, revision: (await f.saved.view(key, "schedules"))!.revision } },
  });
  expect(response.status, await response.clone().text()).toBeLessThan(400);
  const receipt = await f.journal.wait("project-schedule");
  expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded" });
  expect(await readFile(join(f.pod, "settings/schedule/project.json"), "utf8")).toBe("{}");
});

// M3: a push carrying a project-only Pod must pass the target pointer at preparation.
test("schedule push prepares with the target project-only Pod", async () => {
  await projectFixture(false);
  const { setup } = await import("./schedule-recorded-fixture.ts");
  const f = await setup({ projectHome: "Projects/Example", pod: "project-only" });
  f.select("fresh-schedule-04-revit.detail.schedules");
  const result = await f.submit();
  expect(result, JSON.stringify(result)).toMatchObject({
    state: "succeeded",
    result: { applied: 2 },
  });
});

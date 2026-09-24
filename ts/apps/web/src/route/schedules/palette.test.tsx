// @vitest-environment jsdom
/** The Situation palette on `/schedules`: Ctrl K opens the sentence's ladder; a pick reads it. */
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { scheduleCatalogSchema } from "@pe/agent-contracts";
import { Ladder } from "#/route/ladder";
import { PaletteKey } from "#/route/situation-marks";
import { scheduleRung } from "./stage";

afterEach(cleanup);

const catalog = scheduleCatalogSchema.parse({
  schedules: [
    { scheduleId: 7, name: "AHU Schedule", categoryName: "Mechanical Equipment", rowCount: 4 },
    { scheduleId: 9, name: "Door Schedule", categoryName: "Doors", rowCount: 0 },
  ],
});

function Head({ execute }: { execute: Parameters<typeof scheduleRung>[3] }) {
  const [open, setOpen] = useState(false);
  return (
    <p>
      <Ladder
        levels={[scheduleRung(catalog, null, undefined, execute)]}
        open={open}
        onOpenChange={setOpen}
      />
      <PaletteKey open={() => setOpen(true)} />
    </p>
  );
}

test("Ctrl K opens the schedule list by category, and a pick reads that schedule", async () => {
  const reads: unknown[] = [];
  render(
    <Head
      execute={async (...call) => {
        reads.push(call);
        return null;
      }}
    />,
  );
  expect(screen.queryByText("AHU Schedule")).toBeNull();
  await act(async () => fireEvent.keyDown(document.body, { key: "k", ctrlKey: true }));
  expect(screen.getByText("Mechanical Equipment")).toBeTruthy();
  expect(screen.getByText("4 rows")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByText("AHU Schedule")));
  expect(reads).toEqual([["refresh", { scheduleId: 7 }]]);
  expect(screen.queryByText("Door Schedule")).toBeNull();
});

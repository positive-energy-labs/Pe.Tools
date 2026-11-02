import { test, expect } from "vite-plus/test";
import running from "./fixtures/families-running-action.json" with { type: "json" };
import { actionReceiptSchema, actionStatusSchema } from "../src/action-receipts.ts";
import { createPeClient } from "../src/pe-api.ts";
// Captured from live-20261102-families-3/ev/action-events.jsonl, event 50, c510da4b.
// GET /actions projects the same receipt through actionStatusSchema (call-route.ts).
test.each(["status", "receipt"])(
  "actions.read decodes a real in-progress %s projection",
  async (kind) => {
    const receipt = actionReceiptSchema.parse(running);
    const payload = JSON.parse(
      JSON.stringify(kind === "status" ? actionStatusSchema.parse(receipt) : receipt),
    );
    const client = createPeClient("http://host", async () => Response.json([payload]));
    const rows = await client.call(
      "actions.read",
      kind === "receipt" ? { query: { id: receipt.id } } : {},
    );
    expect(rows[0]).toMatchObject({
      id: receipt.id,
      state: "running",
      outcome: { state: "running" },
    });
    if (kind === "status") expect(rows[0]).not.toHaveProperty("steps");
    else expect(rows[0]).toHaveProperty("steps");
  },
);

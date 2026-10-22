// @vitest-environment jsdom
import { deliverFeedback, sendFeedback, type Feedback } from "#/host/feedback";
import { hostFetch } from "#/host/runtime";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("#/host/runtime", () => ({ hostFetch: vi.fn() }));

vi.mock("#/readings", () => ({
  useAction: () => ({ isPending: false, error: null, mutate: vi.fn() }),
}));
vi.mock("react-grab/primitives", () => ({
  getElementAtPoint: () => null,
  isElementGrabbable: () => true,
}));
afterEach(cleanup);

const note: Feedback = {
  comment: "the duct table hides the 4th column",
  url: "http://127.0.0.1:5180/pea?thread=t1",
  selector: "#duct-table",
  component: "DuctTable",
  components: ["DuctTable", "Pane"],
  html: '<table id="duct-table"></table>',
  rect: { x: 1, y: 2, width: 3, height: 4 },
  viewport: { width: 800, height: 600, dpr: 1 },
  picture: "data:image/webp;base64,AAAA",
  picture_error: null,
};
const answer = (status: number, body: unknown) =>
  vi.mocked(hostFetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const id = "10000000-0000-4000-8000-0000000000fe";

test("explicit feedback still submits its full content, and kept vs delivered are two facts", async () => {
  answer(200, { feedbackId: id, delivery: "failed", error: "PostHog answered 503" });
  await expect(sendFeedback(note)).resolves.toEqual({
    feedbackId: id,
    delivery: "failed",
    error: "PostHog answered 503",
  });
  const [url, init] = vi.mocked(hostFetch).mock.calls.at(-1)!;
  expect(url).toMatch(/\/pe\/feedback$/);
  expect(JSON.parse(init!.body as string)).toEqual(note);

  answer(200, { feedbackId: id, delivery: "uncertain", error: "PostHog may have it" });
  await expect(deliverFeedback(id)).resolves.toMatchObject({ delivery: "uncertain" });

  answer(200, { feedbackId: id, delivery: "accepted" });
  await expect(deliverFeedback(id)).resolves.toEqual({ feedbackId: id, delivery: "accepted" });
  const [again, retry] = vi.mocked(hostFetch).mock.calls.at(-1)!;
  expect(again).toMatch(new RegExp(`/pe/feedback/${id}/deliver$`));
  expect(retry!.body).toBeUndefined(); // the browser never resends the content

  answer(400, { error: { code: "route.input", message: "invalid feedback" } });
  await expect(sendFeedback(note)).rejects.toThrow("invalid feedback");
  answer(200, { ok: true });
  await expect(sendFeedback(note)).rejects.toThrow("Invalid response for feedback.submit");
});

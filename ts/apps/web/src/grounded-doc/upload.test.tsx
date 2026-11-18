// @vitest-environment jsdom
// The upload surface posts to the host's parse door (homes ledger 2026-11-17), never to a web-server route.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useGroundedDoc } from "#/grounded-doc/engine";
import { GroundedDocView } from "#/grounded-doc/view/block-markdown";

vi.mock("@pe/kit/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Lab() {
  return <GroundedDocView engine={useGroundedDoc()} />;
}
const view = {
  jobId: "job",
  fileName: "cut.pdf",
  pages: [{ page: 1, width: 100, height: 200, screenshotUrl: "data:image/png;base64,AA==", markdown: "" }],
  blocks: [{ id: "p1-i0", page: 1, kind: "text", md: "Airflow 1200 CFM", bboxes: [] }],
  images: [],
};
const blob = { digest: "a".repeat(64), fileName: "cut.pdf", size: 9 };
/** The host's answers; every request the page makes is recorded as `METHOD path` with its JSON body. */
const host = (parse: () => Response) => {
  const calls: [string, unknown][] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), "http://host"), init);
    const path = new URL(request.url).pathname;
    calls.push([`${request.method} ${path}`, JSON.parse((await request.text()) || "null")]);
    return path === "/actions/blobs" ? Response.json(blob) : parse();
  });
  return calls;
};

test("a picked PDF is retained by the host, parsed at its door, and drawn", async () => {
  const calls = host(() => Response.json(view));
  const { container } = render(<Lab />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["%PDF-1.7"], "cut.pdf", { type: "application/pdf" })] },
  });
  await waitFor(() => expect(screen.getByText("Airflow 1200 CFM")).toBeTruthy());
  expect(calls).toEqual([
    ["POST /actions/blobs", { fileName: "cut.pdf", base64: btoa("%PDF-1.7") }],
    ["POST /pe/family-spec/parse", blob],
  ]);
});

test("a pasted URL goes to the same door, and a refusal is the host's own sentence", async () => {
  const calls = host(() =>
    Response.json({ error: { code: "family.spec.source", message: "Only a public address is fetched here." } }, { status: 400 }),
  );
  render(<Lab />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://vendor.example/cut.pdf?sig=s" } });
  fireEvent.click(screen.getByRole("button", { name: "parse" }));
  await waitFor(() => expect(screen.getByText(/Only a public address is fetched here\./)).toBeTruthy());
  expect(calls).toEqual([["POST /pe/family-spec/parse", { url: "https://vendor.example/cut.pdf?sig=s" }]]);
});

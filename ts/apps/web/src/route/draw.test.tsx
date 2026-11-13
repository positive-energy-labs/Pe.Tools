// @vitest-environment jsdom
// D18: a drawing that is still loading keeps the page unsettled. The marks are the journey's own:
// `settled` (test-journey.ts) in jsdom, and `readMarks` (tests/e2e/marks.ts), the function a CDP
// journey runs in Chrome.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { readMarks, settled as marksSettled, LAYER } from "../../../../tests/e2e/marks.ts";
import { settled } from "../test-journey";
import { draw } from "./draw";
import { overlay, type PictureOverlayProps } from "./slots/picture/overlay";

afterEach(cleanup);

function loader<M>() {
  let land!: (module: M) => void;
  const loaded = new Promise<M>((resolve) => (land = resolve));
  return { load: () => loaded, land };
}
const Body = ({ ctx }: { ctx: { says: string } }) => <p>{ctx.says}</p>;
const Over = ({ ctx }: PictureOverlayProps<{ says: string }>) => <p>{ctx.says}</p>;

test("D18 a pane whose drawing is still loading keeps the page unsettled, and settles when it lands", async () => {
  const body = loader<{ Body: typeof Body }>();
  const page = render(<section data-url-settled="">{draw("scroll", body.load, "Body")({ says: "drawn" }).node}</section>);
  // The URL is flushed and no picker is open: only the loading drawing holds the page.
  expect(readMarks(LAYER)).toEqual({ busy: true, urlSettled: true, picker: false });
  expect(marksSettled(readMarks(LAYER))).toBe(false);
  await expect(settled(page.container, 50)).rejects.toThrow("still busy");
  await act(async () => body.land({ Body }));
  await settled(page.container);
  expect(marksSettled(readMarks(LAYER))).toBe(true);
  expect(page.getByText("drawn")).toBeTruthy();
});

test("D18 a picture overlay that is still loading keeps the page unsettled", async () => {
  const over = loader<{ Over: typeof Over }>();
  const Overlay = overlay(over.load, "Over");
  render(<section data-url-settled=""><Overlay ctx={{ says: "overlaid" }} scope={null as never} picture={() => null} /></section>);
  expect(marksSettled(readMarks(LAYER))).toBe(false);
  await act(async () => over.land({ Over }));
  expect(marksSettled(readMarks(LAYER))).toBe(true);
});

test("D18 a hidden Place's loading drawing does not hold the shown page", () => {
  const body = loader<{ Body: typeof Body }>();
  render(<><div inert>{draw("scroll", body.load, "Body")({ says: "hidden" }).node}</div><section data-url-settled="" /></>);
  expect(marksSettled(readMarks(LAYER))).toBe(true);
});

test("D18 one boundary owns the loading fallback: no other source writes it", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..");
  const writers = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
    .filter((file) => readFileSync(join(src, file), "utf8").includes("Loading drawing"));
  expect(writers.map((file) => file.replaceAll("\\", "/"))).toEqual(["route/draw.tsx"]);
});

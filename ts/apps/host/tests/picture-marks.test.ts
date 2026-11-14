import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vite-plus/test";

test("pe.picture answers pixel marks and asks for surrounding context", async () => {
  const source = (await readFile(new URL("../src/pages/pe.js", import.meta.url), "utf8")).replace(
    "/*pe:runtime*/ null",
    JSON.stringify({ header: "x-pe-runtime", service: "proof" }),
  );
  const window: Record<string, unknown> = {};
  runInNewContext(source, {
    window,
    location: new URL("http://localhost/pages/proof/"),
    document: { querySelector: () => null },
    URL,
    URLSearchParams,
  });
  const marks = [{ elementId: 7, left: 10, top: 20, width: 30, height: 40 }];
  const pe = window.pe as {
    do: ReturnType<typeof vi.fn>;
    picture: (ids: number[]) => Promise<{ marks: typeof marks; url: string }>;
  };
  pe.do = vi
    .fn()
    .mockResolvedValueOnce({ viewId: 42, viewName: "Lens" })
    .mockResolvedValueOnce({ imageUrl: "/captures/picture.png", marks });
  const answer = await pe.picture([7]);
  expect(answer.marks).toEqual(marks);
  expect(answer.url).toBe("/captures/picture.png");
  expect(pe.do).toHaveBeenLastCalledWith("revit.context.view-image.focus", {
    target: { id: 42 },
    focus: { elementIds: [7] },
    pixelSize: undefined,
    marginPercent: 200,
  });
});

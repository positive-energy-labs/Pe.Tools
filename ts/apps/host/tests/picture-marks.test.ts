import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vite-plus/test";

test("pe.picture answers pixel marks and asks for surrounding context", async () => {
  const source = (await readFile(new URL("../src/pages/pe.js", import.meta.url), "utf8")).replace(
    "/*pe:runtime*/ null",
    JSON.stringify({ header: "x-pe-runtime", service: "proof" }),
  );
  const window: Record<string, unknown> = { addEventListener: vi.fn() };
  runInNewContext(source, {
    window,
    location: new URL("http://localhost/pages/proof/"),
    document: { querySelector: () => null },
    URL,
    URLSearchParams,
  });
  const marks = [{ elementId: 7, left: 10, top: 20, width: 30, height: 40 }];
  const notDrawn = [{ elementId: 8, reasons: ["PhaseHidden"] }];
  const pe = window.pe as {
    do: ReturnType<typeof vi.fn>;
    picture: (ids: number[]) => Promise<{ marks: typeof marks; url: string; notDrawn: typeof notDrawn }>;
  };
  pe.do = vi
    .fn()
    .mockResolvedValueOnce({ viewId: 42, viewName: "Lens" })
    .mockResolvedValueOnce({ imageUrl: "/captures/picture.png", marks, notDrawn });
  const answer = await pe.picture([7]);
  expect(answer.marks).toEqual(marks);
  expect(answer.url).toBe("/captures/picture.png");
  expect(answer.notDrawn).toEqual(notDrawn);
  expect(pe.do).toHaveBeenLastCalledWith("revit.context.view-image.focus", {
    target: { id: 42 },
    focus: { elementIds: [7] },
    pixelSize: undefined,
    marginPercent: 200,
  });
  pe.do = vi.fn().mockResolvedValueOnce({ viewId: 42, viewName: "Lens" })
    .mockResolvedValueOnce({ refused: true, notDrawn });
  await expect(pe.picture([8])).rejects.toMatchObject({
    message: "Picture refused: 8: PhaseHidden", notDrawn,
  });
});

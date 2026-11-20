import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vite-plus/test";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";

test("an unboxed lens carries per-element refusals without inventing a view", () => {
  const response = {
    viewId: null,
    viewName: null,
    created: false,
    boxed: 0,
    note: "No model bounds",
    lens: null,
    hidden: [],
    refused: true,
    notDrawn: [
      { elementId: 6956140, reasons: ["NoBoundingBox"] },
      { elementId: 13006707, reasons: ["ElementMissing"] },
    ],
  };
  expect(nativeResponseSchema("revit.context.lens").parse(response)).toEqual(response);
});

test("pe.picture answers pixel marks and asks for surrounding context", async () => {
  const source = (await readFile(new URL("../src/pages/pe.js", import.meta.url), "utf8")).replace(
    "/*pe:runtime*/ null",
    JSON.stringify({ header: "x-pe-runtime", query: "pe-runtime", service: "proof" }),
  );
  // pe.js registers a `pagehide` listener at load; this bare context has no DOM to supply one.
  const window: Record<string, unknown> = { addEventListener() {} };
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
    picture: (
      ids: number[],
    ) => Promise<{ marks: typeof marks; url: string; notDrawn: typeof notDrawn }>;
  };
  pe.do = vi.fn().mockResolvedValueOnce({ viewId: 42, viewName: "Lens" }).mockResolvedValueOnce({
    imageUrl: "/captures/picture.png",
    marks,
    notDrawn,
    width: 1500,
    height: 1441,
  });
  const answer = await pe.picture([7]);
  expect(answer.marks).toEqual(marks);
  // An <img> sends no header, so the URL carries the runtime owner the dev proxy requires (D47).
  expect(answer.url).toBe("http://localhost/captures/picture.png?pe-runtime=proof");
  expect(answer.notDrawn).toEqual(notDrawn);
  expect(answer).toMatchObject({ width: 1500, height: 1441 });
  expect(pe.do).toHaveBeenLastCalledWith("revit.context.view-image.focus", {
    target: { id: 42 },
    focus: { elementIds: [7] },
    pixelSize: undefined,
    marginPercent: 200,
  });
  pe.do = vi
    .fn()
    .mockResolvedValueOnce({ viewId: 42, viewName: "Lens" })
    .mockResolvedValueOnce({ refused: true, notDrawn });
  await expect(pe.picture([8])).rejects.toMatchObject({
    message: "Picture refused: 8: PhaseHidden",
    notDrawn,
  });
  const unboxed = [
    { elementId: 6956140, reasons: ["NoBoundingBox"] },
    { elementId: 13006707, reasons: ["ElementMissing"] },
  ];
  pe.do = vi.fn().mockResolvedValueOnce({ refused: true, notDrawn: unboxed });
  await expect(pe.picture([6956140, 13006707])).rejects.toMatchObject({
    message: "Picture refused: 6956140: NoBoundingBox; 13006707: ElementMissing",
    refused: true,
    notDrawn: unboxed,
  });
  expect(pe.do).toHaveBeenCalledTimes(1);
});

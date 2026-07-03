import type { ParsedDocView } from "#/grounded-doc/types";

/**
 * Synthetic parse result for exercising the grounded-doc UX without a
 * LlamaCloud key or a live parse. No screenshots on purpose — the page pane
 * renders wireframe boxes, which is also the fallback for real parses that
 * come back without page images.
 */
export const SAMPLE_DOC: ParsedDocView = {
  jobId: "sample",
  fileName: "sample-datasheet.pdf (synthetic)",
  // No extracted images: the images lane only appears for real parses that
  // return embedded/layout figures.
  images: [],
  pages: [
    { page: 1, width: 612, height: 792, screenshotUrl: null, markdown: "" },
    { page: 2, width: 612, height: 792, screenshotUrl: null, markdown: "" },
  ],
  blocks: [
    {
      id: "p1-i0",
      page: 1,
      kind: "heading",
      md: "# ACME Fan Coil Unit — Model FCU-400 Series",
      bboxes: [{ x: 48, y: 40, w: 516, h: 36 }],
    },
    {
      id: "p1-i1",
      page: 1,
      kind: "text",
      md: "The FCU-400 series delivers quiet, high-efficiency hydronic cooling and heating for commercial fit-outs. All models share a common cabinet and differ in coil depth and motor size.",
      bboxes: [{ x: 48, y: 92, w: 516, h: 60 }],
    },
    {
      id: "p1-i2",
      page: 1,
      kind: "table",
      md: [
        "| Parameter | FCU-400-A | FCU-400-B | FCU-400-C |",
        "| --- | --- | --- | --- |",
        "| Nominal Airflow | 400 CFM | 600 CFM | 800 CFM |",
        "| Cooling Capacity | 12.0 MBH | 18.5 MBH | 24.0 MBH |",
        "| Voltage | 115 V | 115 V | 208 V |",
        "| FLA | 1.2 A | 1.8 A | 2.4 A |",
        '| Width | 24" | 30" | 36" |',
      ].join("\n"),
      bboxes: [{ x: 48, y: 180, w: 516, h: 200 }],
    },
    {
      id: "p1-i3",
      page: 1,
      kind: "text",
      md: "Capacities rated at 45°F entering water, 80°F/67°F entering air per AHRI 440.",
      bboxes: [{ x: 48, y: 400, w: 516, h: 30 }],
    },
    {
      id: "p2-i0",
      page: 2,
      kind: "heading",
      md: "## Electrical & Connection Data",
      bboxes: [{ x: 48, y: 40, w: 340, h: 28 }],
    },
    {
      id: "p2-i1",
      page: 2,
      kind: "table",
      md: [
        "| Property | Value |",
        "| --- | --- |",
        '| Supply Connection | 3/4" NPT |',
        '| Return Connection | 3/4" NPT |',
        '| Condensate | 7/8" OD |',
        "| MCA | 3.0 A |",
        "| MOCP | 15 A |",
      ].join("\n"),
      bboxes: [{ x: 48, y: 90, w: 300, h: 160 }],
    },
    {
      id: "p2-i2",
      page: 2,
      kind: "text",
      md: "Note: all units ship with a factory-mounted disconnect. Field wiring must comply with NEC and local codes.",
      bboxes: [{ x: 48, y: 280, w: 516, h: 44 }],
    },
    {
      id: "p2-i3",
      page: 2,
      kind: "footer",
      md: "ACME Corp · Submittal 24-118 · Page 2 of 2",
      bboxes: [],
    },
  ],
};

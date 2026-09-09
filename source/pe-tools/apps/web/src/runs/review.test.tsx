// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vite-plus/test";
import { overlaySvg } from "./feedback/composite";
import { ReviewList, ReviewShapes, reviewShapes, partitionReviewShapes } from "./review";
import { partitionReviewSchema } from "@pe/agent-contracts";
import { PartitionReview } from "#/takeoff/partition-review";
import { parseZoneTsv, ringPath, type ZoneRecord } from "./world";

afterEach(cleanup);

it("keeps holes, exact points, dispositions and reasons through selection, flagging and export", () => {
  const geom = parseZoneTsv(
    [
      "ROOM\tR01\t10\t1\t2\t2\t\taccepted",
      "ROOM\tR02\t0.24\t1\t3\t3\t\theld",
      "ROOM\tR03\t2\t1\t4\t4\t\t",
      ...["R01", "R02", "R03"].map((id) => `POLY\t${id}\touter\t0.123456789;0|5;0|5;5|0;5`),
      "POLY\tR02\thole\t1;1|2;1|2;2|1;2",
      "META\tresidue\tR04\tvoid\t0.4\t1\t1\t0\t1;1|2;1|2;2",
      "META\tresidue\tR05\texcluded\t1\t1\t1\t0\t2;2|3;2|3;3",
    ].join("\n"),
  );
  const zone = {
    Zone: "test",
    ZoneLoops: [],
    RejectionDetails: { R02: "too-small", R04: "low-headroom", R05: "outside" },
  } as unknown as ZoneRecord;
  const vp = { minX: 0, minY: 0, maxX: 5, maxY: 5, pxPerFt: 1, widthPx: 5, heightPx: 5 };
  const shapes = reviewShapes(geom, zone);
  expect(shapes.map((s) => s.disposition)).toEqual(["accepted", "held", null, "void", "excluded"]);
  expect(geom.rooms[2]?.ceil).toBeNull();
  expect(shapes[1]?.loops).toHaveLength(2);
  expect(ringPath(vp, shapes[1]!.loops)).toContain("M0.123456789 5");
  function Review() {
    const [selected, select] = useState<string | null>(null);
    const [flags, flag] = useState<string[]>([]);
    return (
      <>
        <svg>
          <ReviewShapes
            shapes={shapes}
            zone="test"
            runId="immutable-run"
            vp={vp}
            selected={selected}
            flags={flags}
            onSelect={select}
          />
        </svg>
        <ReviewList
          shapes={shapes}
          selected={selected}
          flags={flags}
          onSelect={select}
          onFlag={(key) => flag(flags.includes(key) ? [] : [key])}
        />
      </>
    );
  }
  render(<Review />);
  const held = screen.getAllByRole("button", { name: /held R02.*too-small/ })[0]!;
  fireEvent.keyDown(held, { key: "Enter" });
  expect(held.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "flag R04" }));
  expect(screen.getByRole("button", { name: "unflag R04" })).toBeTruthy();
  const svg = overlaySvg(vp, zone, geom, new Set(["residue:R04"]));
  for (const label of [
    "held R02",
    "too-small",
    "void R04",
    "low-headroom",
    "excluded R05",
    "unknown R03",
  ])
    expect(svg).toContain(label);
  expect(svg).toContain('fill-rule="evenodd"');
  expect(svg).toContain("M0.123456789 5");
  expect(svg).toContain("⚑ ");
  const portable = partitionReviewSchema.parse({
    source: { runId: "unchanged", documentKey: "doc", scopeKey: "scope" },
    zone: { key: "zone", name: "zone", loops: [] },
    shapes: shapes.map(({ key, label, ...shape }) => ({
      ...shape,
      kind: key.split(":")[0],
      label: label ?? null,
    })),
  });
  expect(partitionReviewShapes(portable)).toEqual(shapes);
  expect(portable.source.runId).toBe("unchanged");
  const review = render(
    <PartitionReview
      review={{ zone: "zone", data: portable, flags: ["residue:R04"] }}
      onFlag={() => {}}
    />,
  );
  const link = review.getByRole("link", { name: "export review JSON" });
  const exported = JSON.parse(
    decodeURIComponent(link.getAttribute("href")!.split(",").slice(1).join(",")),
  );
  expect(exported).toEqual({ ...portable, flags: ["residue:R04"] });
});

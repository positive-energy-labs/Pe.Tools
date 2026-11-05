import { describe, expect, it } from "vite-plus/test";

import { ductsDocumentSchema, salvageDuctsWork, stagedDucts } from "./ducts.ts";
import { neutralFansWork } from "./fans.ts";

it("keeps the person's hex palette in Work and excludes it from native staged inputs", () => {
  const value = {
    supply: "#0569a5",
    return: "#02bba4",
    exhaust: "#fea665",
    fresh: "#1cbcd5",
    unknown: "#808080",
  };
  const doc = ductsDocumentSchema.parse({ systemColours: { edit: { value } } });
  expect(salvageDuctsWork(doc).doc.systemColours.edit?.value).toEqual(value);
  expect(stagedDucts(doc, neutralFansWork)).not.toHaveProperty("systemColours");
  expect(
    ductsDocumentSchema.safeParse({
      systemColours: { edit: { value: { ...value, supply: "red" } } },
    }).success,
  ).toBe(false);
});

const rule = { edit: { value: { table: "CR3-1" } } };

describe("salvageDuctsWork", () => {
  it("returns readable Work untouched", () => {
    const raw = { rules: { "2": rule } };
    const out = salvageDuctsWork(raw);
    expect(out.dropped).toEqual([]);
    expect(out.doc).toEqual(ductsDocumentSchema.parse(raw));
  });

  it("keeps every cell that parses and names only the broken ones", () => {
    const out = salvageDuctsWork({
      rules: { "2": rule, "3": { edit: { value: { table: 7 } } } },
      subject: { g1: { edit: { value: "old shape" } } },
      unitStatics: { "1": {} },
      labelParameter: { edit: { value: "PE_G___TagInstance" } },
    });
    expect(out.whole).toBe(false);
    expect(out.dropped.toSorted()).toEqual(["rules.3", "subject.g1", "unitStatics"]);
    expect(Object.keys(out.doc.rules)).toEqual(["2"]);
    expect(out.doc.labelParameter.edit?.value).toBe("PE_G___TagInstance");
    expect(out.doc.subject).toEqual({});
  });

  it("reads a non-document as nothing and says so", () => {
    expect(salvageDuctsWork(null)).toMatchObject({ dropped: ["(whole document)"], whole: true });
  });

  it("drops the cross-cell segments when a rule breaks them", () => {
    // Each cell parses alone; the document rule (an assumption's kind follows its key) breaks.
    const out = salvageDuctsWork({
      assumptions: { "proximity:1:2|2:1": { edit: { value: { kind: "fan-static", inWg: 1 } } } },
      rules: { "2": rule },
    });
    expect(Object.keys(out.doc.rules)).toEqual(["2"]);
    expect(out.doc.assumptions).toEqual({});
    expect(out.dropped).toEqual(["assumptions"]);
  });
});

import { describe, expect, it } from "vite-plus/test";

import { ductsDocumentSchema, salvageDuctsWork, stagedDucts } from "./ducts.ts";

it("keeps the person's hex palette in Work and excludes it from native staged inputs", () => {
  const value = {
    supply: "#0569a5",
    return: "#02bba4",
    exhaust: "#fea665",
    fresh: "#1cbcd5",
    unknown: "#808080",
  };
  const doc = ductsDocumentSchema.parse({ systemColours: { staged: { value } } });
  expect(salvageDuctsWork(doc).doc.systemColours.staged?.value).toEqual(value);
  expect(stagedDucts(doc)).not.toHaveProperty("systemColours");
  expect(
    ductsDocumentSchema.safeParse({
      systemColours: { staged: { value: { ...value, supply: "red" } } },
    }).success,
  ).toBe(false);
});

const flow = { staged: { value: { cfm: 150, source: "fixture" } } };

describe("salvageDuctsWork", () => {
  it("returns readable Work untouched", () => {
    const raw = { flows: { "2": flow } };
    const out = salvageDuctsWork(raw);
    expect(out.dropped).toEqual([]);
    expect(out.doc).toEqual(ductsDocumentSchema.parse(raw));
  });

  it("keeps every cell that parses and names only the broken ones", () => {
    const out = salvageDuctsWork({
      flows: { "2": flow, "3": { staged: { value: { cfm: "lots" } } } },
      subject: { g1: { staged: { value: "old shape" } } },
      unitStatics: { "1": {} },
      labelParameter: { staged: { value: "PE_G___TagInstance" } },
    });
    expect(out.whole).toBe(false);
    expect(out.dropped.toSorted()).toEqual(["flows.3", "subject.g1", "unitStatics"]);
    expect(Object.keys(out.doc.flows)).toEqual(["2"]);
    expect(out.doc.labelParameter.staged?.value).toBe("PE_G___TagInstance");
    expect(out.doc.subject).toEqual({});
  });

  it("reads a non-document as nothing and says so", () => {
    expect(salvageDuctsWork(null)).toMatchObject({ dropped: ["(whole document)"], whole: true });
  });

  it("drops the cross-cell segments when a rule breaks them", () => {
    const out = salvageDuctsWork({
      claims: {
        c: {
          proposal: {
            value: { title: "Run", text: "x", ids: [1], state: "assumed", verdict: "yes" },
          },
        },
      },
      flows: { "2": flow },
    });
    expect(Object.keys(out.doc.flows)).toEqual(["2"]);
    expect(out.dropped.length).toBeGreaterThan(0);
  });
});

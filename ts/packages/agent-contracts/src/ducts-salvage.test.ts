import { describe, expect, it } from "vite-plus/test";

import { DUCTS_FINDS, ductsDocumentSchema, salvageDuctsWork } from "./ducts.ts";

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
          proposal: { value: { text: "x", ids: [1], state: "assumed", verdict: "yes" } },
        },
      },
      flows: { "2": flow },
    });
    expect(Object.keys(out.doc.flows)).toEqual(["2"]);
    expect(out.dropped.length).toBeGreaterThan(0);
  });
});

describe("DUCTS_FINDS", () => {
  it("answers the words a person uses for duct pressure drop", () => {
    for (const word of ["pressure drop", "pdrop", "static pressure", "esp", "duct"])
      expect(DUCTS_FINDS).toContain(word);
  });
});

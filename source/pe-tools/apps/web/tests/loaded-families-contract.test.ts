import { expect, test } from "vite-plus/test";
import { flattenMatrix } from "../src/host/contracts";

// Captured verbatim from a live Pe.Host matrix response. The host nests parameter
// fields under `definition`, uses `presence` (not `scope`), and emits null cells.
// The generated zod schema (reflected from C#) parses this faithfully; the flatten
// adapter shapes it for the table UI. This fixture guards both.
const realMatrixResponse = {
  families: [
    {
      familyId: 7719071,
      familyUniqueId: "401bbc9d-2d1e-46bc-bd46-45bc6bb1b40b-0075c89f",
      familyName: "!Mechanical Equipment_Clearance_Rectangular_UH",
      categoryName: "Mechanical Equipment",
      placedInstanceCount: 0,
      types: [{ typeName: "!Mechanical Equipment_Clearance_Rectangular_UH" }],
      scheduleNames: [],
      visibleParameters: [
        {
          definition: {
            dataTypeId: "autodesk.spec:spec.bool-1.0.0",
            dataTypeLabel: "Yes/No",
            groupTypeId: "autodesk.parameter.group:identityData-1.0.0",
            groupTypeLabel: "Identity Data",
            identity: {
              key: "parameter-element:4801951",
              kind: "ParameterElement",
              name: "Appears in Schedule",
              parameterElementId: 4801951,
            },
            isInstance: true,
          },
          formulaState: "NotApplicable",
          kind: "ProjectParameter",
          presence: "ProjectBindingOnly",
          storageType: "Integer",
          valuesByType: {
            "!Mechanical Equipment_Clearance_Rectangular_UH": null,
            default: null,
          },
        },
        {
          definition: {
            groupTypeLabel: "Materials and Finishes",
            identity: { key: "shared:abc", kind: "SharedGuid", name: "Clearance Block Material" },
            isInstance: false,
          },
          formulaState: "None",
          kind: "FamilyParameter",
          presence: "Family",
          storageType: "ElementId",
          valuesByType: {
            "!Mechanical Equipment_Clearance_Rectangular_UH": "PE Clearance [ID:3890443]",
          },
        },
      ],
      excludedParameters: [
        {
          definition: {
            dataTypeLabel: "Area (Common)",
            groupTypeLabel: "Dimensions",
            identity: { key: "builtin:-1012805", kind: "BuiltInParameter", name: "Area" },
            isInstance: true,
          },
          excludedReason: "ProjectObservedBuiltIn",
          formulaState: "NotApplicable",
          kind: "Unknown",
          presence: "Unresolved",
        },
      ],
      issues: [],
    },
  ],
  issues: [],
};

test("matrix response flattens definition + presence and coerces null cells", () => {
  const { families } = flattenMatrix(realMatrixResponse);
  const fam = families[0];
  const [vp, vp2] = fam.visibleParameters;

  // nested definition flattened
  expect(vp.identity.name).toBe("Appears in Schedule");
  expect(vp.isInstance).toBe(true);
  expect(vp.groupTypeLabel).toBe("Identity Data");
  // presence → scope
  expect(vp.scope).toBe("ProjectBindingOnly");
  expect(vp2.scope).toBe("Family");
  // null cells coerced to "", real values preserved
  expect(vp.valuesByType.default).toBe("");
  expect(vp2.valuesByType["!Mechanical Equipment_Clearance_Rectangular_UH"]).toBe(
    "PE Clearance [ID:3890443]",
  );

  const ex = fam.excludedParameters[0];
  expect(ex.identity.name).toBe("Area");
  expect(ex.scope).toBe("Unresolved");
  expect(ex.excludedReason).toBe("ProjectObservedBuiltIn");
});

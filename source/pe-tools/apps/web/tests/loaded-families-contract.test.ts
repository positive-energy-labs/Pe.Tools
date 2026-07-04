import { expect, test } from "vite-plus/test";
import {
  cellText,
  decodeMatrixData,
  excludedParameters,
  visibleParameters,
} from "../src/host/loaded-families-view";

// Hand-authored to the reshaped wire contract (FamilySnapshotRecord). The host
// nests parameter fields under `definition`, names the presence enum field
// `scope`, ships ONE `parameters` list (excluded entries carry a non-null
// `excludedReason`), and preserves null cells (`null` = no value, `""` = empty
// string). The generated Effect schema parses this faithfully; components read
// the record directly and coerce only at render via `cellText`.
const matrixResponse = {
  families: [
    {
      familyId: 7719071,
      familyUniqueId: "401bbc9d-2d1e-46bc-bd46-45bc6bb1b40b-0075c89f",
      familyName: "!Mechanical Equipment_Clearance_Rectangular_UH",
      categoryName: "Mechanical Equipment",
      versionGuid: "88a878a1-6b0c-4c95-b32b-7cf6f4b3ba54",
      isPartial: false,
      placedInstanceCount: 0,
      typeNames: ["!Mechanical Equipment_Clearance_Rectangular_UH"],
      scheduleNames: [],
      parameters: [
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
          scope: "ProjectBindingOnly",
          storageType: "Integer",
          excludedReason: null,
          valuesPerType: {
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
          scope: "Family",
          storageType: "ElementId",
          valuesPerType: {
            "!Mechanical Equipment_Clearance_Rectangular_UH": "PE Clearance [ID:3890443]",
            default: "",
          },
        },
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
          scope: "Unresolved",
          storageType: "Double",
          valuesPerType: {},
        },
      ],
      issues: [],
    },
  ],
  issues: [],
};

test("matrix response decodes and helpers split visible/excluded on excludedReason", () => {
  const { families } = decodeMatrixData(matrixResponse);
  const fam = families[0];

  // canonical record fields survive decode as-is
  expect(fam.typeNames).toEqual(["!Mechanical Equipment_Clearance_Rectangular_UH"]);
  expect(fam.isPartial).toBe(false);
  expect(fam.parameters).toHaveLength(3);

  // one parameters list, split by excludedReason
  const visible = visibleParameters(fam);
  const excluded = excludedParameters(fam);
  expect(visible.map((p) => p.definition.identity.name)).toEqual([
    "Appears in Schedule",
    "Clearance Block Material",
  ]);
  expect(excluded).toHaveLength(1);
  expect(excluded[0].definition.identity.name).toBe("Area");
  expect(excluded[0].excludedReason).toBe("ProjectObservedBuiltIn");

  // nested definition + native scope field on the wire
  const [vp, vp2] = visible;
  expect(vp.definition.identity.name).toBe("Appears in Schedule");
  expect(vp.definition.isInstance).toBe(true);
  expect(vp.definition.groupTypeLabel).toBe("Identity Data");
  expect(vp.scope).toBe("ProjectBindingOnly");
  expect(vp2.scope).toBe("Family");
});

test("null vs empty-string cells are preserved by decode and coerced only at render", () => {
  const fam = decodeMatrixData(matrixResponse).families[0];
  const [vp, vp2] = visibleParameters(fam);

  // decode preserves the wire distinction: null = no value, "" = empty string
  expect(vp.valuesPerType.default).toBeNull();
  expect(vp2.valuesPerType.default).toBe("");
  expect(vp2.valuesPerType["!Mechanical Equipment_Clearance_Rectangular_UH"]).toBe(
    "PE Clearance [ID:3890443]",
  );

  // render helper coerces both to displayable text
  expect(cellText(vp.valuesPerType.default)).toBe("");
  expect(cellText(vp2.valuesPerType.default)).toBe("");
  expect(cellText(vp2.valuesPerType["!Mechanical Equipment_Clearance_Rectangular_UH"])).toBe(
    "PE Clearance [ID:3890443]",
  );
  expect(cellText(vp.valuesPerType["missing-type"])).toBe("");
});

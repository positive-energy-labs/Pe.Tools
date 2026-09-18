/** One reviewed native parameter behind a binding. */
export const target = (elementId: number, rawValue: string | null = "100") => ({
  elementId,
  parameterId: 555,
  parameterName: "Load",
  storageType: "Double",
  isReadOnly: false,
  hasValue: rawValue != null,
  rawValue,
});

export function detailResponse() {
  return {
    documentTitle: "Project.rvt",
    queryKind: "CurrentActiveView",
    requestedScheduleCount: 1,
    resolvedScheduleCount: 1,
    entries: [
      {
        scheduleId: 42,
        scheduleUniqueId: "uid-42",
        scheduleName: "Panel Schedule",
        columns: [
          {
            columnNumber: 1,
            headerText: "Mark",
            fieldName: "Mark",
            isCalculated: false,
            isCombinedParameter: false,
          },
          {
            columnNumber: 2,
            headerText: "Load",
            fieldName: "Load",
            isCalculated: false,
            isCombinedParameter: false,
          },
        ],
        rows: [
          {
            rowNumber: 1,
            kind: "Data",
            values: ["P-1", "100 VA"],
            subjectIds: [7, 8],
            bindings: [
              {
                columnNumber: 2,
                targetElementIds: [7, 8],
                parameterName: "Load",
                parameterId: 555,
                storageType: "Double",
                rawValue: "100",
                displayValue: "100 VA",
                isTypeParameter: true,
                isEditable: true,
                blocker: "None",
                hasMixedValues: false,
                // One shared type parameter behind both instances.
                targets: [target(7), target(8)],
              },
            ],
          },
        ],
      },
    ],
    issues: [],
    page: { totalCount: 1, returnedCount: 1, isTruncated: false },
  };
}

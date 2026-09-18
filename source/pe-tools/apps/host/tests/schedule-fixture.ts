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
                displayValue: "100 VA",
                isTypeParameter: true,
                isEditable: true,
                blocker: "None",
                hasMixedValues: false,
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

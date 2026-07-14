import { expect, test } from "vite-plus/test";
import {
  type ScheduleGridDocument,
  scheduleCellKey,
  scheduleGridRouteState,
} from "@pe/agent-contracts";
import { createScheduleGridCommandHandlers } from "../src/pea/schedule-grid-commands.ts";

// The handlers reach Revit through HostRpcCaller.call, which POSTs {key,request} to `${base}/call`.
// Stub globalThis.fetch (the established mcps-test idiom, see host-rpc-caller.test.ts) so tests
// route each host key to a canned response and can inspect the outgoing request.
function withHostCall(route: (key: string, request: unknown) => unknown): {
  handlers: ReturnType<typeof createScheduleGridCommandHandlers>;
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : ((input as URL).href ?? String(input));
    if (!url.endsWith("/call")) throw new Error(`unexpected fetch ${url}`);
    const { key, request } = JSON.parse(init?.body as string) as { key: string; request: unknown };
    const body = route(key, request);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return {
    handlers: createScheduleGridCommandHandlers({ hostBaseUrl: "http://127.0.0.1:9" }),
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function emptyDoc(): ScheduleGridDocument {
  return { binding: { target: null }, snapshot: null, cells: {}, pushedAt: null };
}

function ctxFor(document: ScheduleGridDocument) {
  return { getDoc: () => document, setDoc: async () => undefined };
}

/** A single-schedule detail response with one bound, editable, type-parameter cell (row 1, column 2). */
function detailResponse() {
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

test("refresh maps the first resolved schedule entry onto the snapshot", async () => {
  const requests: { key: string; request: unknown }[] = [];
  const { handlers, restore } = withHostCall((key, request) => {
    requests.push({ key, request });
    return detailResponse();
  });
  const document = emptyDoc();
  try {
    const result = await handlers.refresh({}, ctxFor(document));

    expect(requests[0]?.key).toBe("revit.detail.schedules");
    const query = (
      requests[0]!.request as { query: { kind: string; projection: { view: string } } }
    ).query;
    expect(query.kind).toBe("CurrentActiveView");
    expect(query.projection.view).toBe("Rows");

    expect(document.snapshot?.scheduleName).toBe("Panel Schedule");
    expect(document.snapshot?.columns).toHaveLength(2);
    expect(document.snapshot?.rows[0]?.bindings[0]?.parameterId).toBe(555);
    expect(document.snapshot?.takenAt).toBeTruthy();
    expect(result).toMatchObject({ scheduleName: "Panel Schedule", columnCount: 2, rowCount: 1 });
  } finally {
    restore();
  }
});

test("refresh routes a scheduleName to a ScheduleNames query and errors when nothing resolves", async () => {
  const requests: { key: string; request: unknown }[] = [];
  const { handlers, restore } = withHostCall((key, request) => {
    requests.push({ key, request });
    return {
      documentTitle: "Project.rvt",
      queryKind: "ScheduleNames",
      requestedScheduleCount: 1,
      resolvedScheduleCount: 0,
      entries: [],
      issues: [],
      page: null,
    };
  });
  try {
    await expect(handlers.refresh({ scheduleName: "Nope" }, ctxFor(emptyDoc()))).rejects.toThrow(
      "No schedule resolved",
    );
    const query = (requests[0]!.request as { query: { kind: string; scheduleNames: string[] } })
      .query;
    expect(query.kind).toBe("ScheduleNames");
    expect(query.scheduleNames).toEqual(["Nope"]);
  } finally {
    restore();
  }
});

test("push expands a type-parameter cell to one edit per target element id, then folds + clears", async () => {
  const applyRequests: { edits: { elementId: number; parameterId?: number; value?: string }[] }[] =
    [];
  const { handlers, restore } = withHostCall((key, request) => {
    if (key !== "revit.apply.parameter-values") throw new Error(`unexpected host call ${key}`);
    applyRequests.push(
      request as { edits: { elementId: number; parameterId?: number; value?: string }[] },
    );
    return {
      applied: 2,
      dryRun: false,
      results: [
        { index: 0, ok: true },
        { index: 1, ok: true },
      ],
    };
  });
  const document = emptyDoc();
  document.snapshot = detailResponse().entries[0] as unknown as ScheduleGridDocument["snapshot"];
  const key = scheduleCellKey(1, 2);
  document.cells[key] = { staged: { value: "150 VA" }, review: "good" };

  try {
    const result = await handlers.push({}, ctxFor(document));

    const applyRequest = applyRequests[0];
    expect(applyRequest?.edits).toHaveLength(2);
    expect(applyRequest?.edits.map((edit) => edit.elementId)).toEqual([7, 8]);
    expect(
      applyRequest?.edits.every((edit) => edit.parameterId === 555 && edit.value === "150 VA"),
    ).toBe(true);
    // Fold + clear: snapshot value updated, binding display refreshed, cell reset.
    expect(document.snapshot?.rows[0]?.values[1]).toBe("150 VA");
    expect(document.snapshot?.rows[0]?.bindings[0]?.displayValue).toBe("150 VA");
    expect(document.cells[key]).toEqual({ review: "none" });
    expect(result).toEqual({ applied: 1, failures: [] });
  } finally {
    restore();
  }
});

test("push fails a non-editable / blocked cell without calling Revit", async () => {
  let hostCalled = false;
  const { handlers, restore } = withHostCall(() => {
    hostCalled = true;
    return {};
  });
  const document = emptyDoc();
  const entry = detailResponse().entries[0];
  entry.rows[0].bindings[0].isEditable = false;
  entry.rows[0].bindings[0].blocker = "ReadOnlyParameter";
  document.snapshot = entry as unknown as ScheduleGridDocument["snapshot"];
  const key = scheduleCellKey(1, 2);
  document.cells[key] = { staged: { value: "150 VA" }, review: "good" };

  try {
    const result = (await handlers.push({}, ctxFor(document))) as {
      applied: number;
      failures: { key: string; error: string }[];
    };

    expect(hostCalled).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.failures[0]?.key).toBe(key);
    expect(result.failures[0]?.error).toContain("ReadOnlyParameter");
    // Failed cell stays staged.
    expect(document.cells[key]?.staged?.value).toBe("150 VA");
  } finally {
    restore();
  }
});

test("push blocks when a staged cell still needs review", async () => {
  const document = emptyDoc();
  document.cells[scheduleCellKey(1, 2)] = { staged: { value: "9" }, review: "attention" };
  const handlers = createScheduleGridCommandHandlers({ hostBaseUrl: "http://127.0.0.1:9" });

  await expect(handlers.push({}, ctxFor(document))).rejects.toThrow(
    "Commit blocked: 1 staged cell need review.",
  );
});

test("command input schemas accept the web client payloads", () => {
  const commands = scheduleGridRouteState.commands;
  expect(commands.refresh.input.safeParse({}).success).toBe(true);
  expect(commands.refresh.input.safeParse({ scheduleName: "Panel", maxRows: 50 }).success).toBe(
    true,
  );
  expect(commands.push.input.safeParse({}).success).toBe(true);
});

// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { useFamiliesColumns } from "#/families/matrix-columns";

test("a parameter on the only scoped family remains visible as common", () => {
  const { result, unmount } = renderHook(() =>
    useFamiliesColumns({
      familyState: () => ({ word: "unread", tone: "mute", note: "No plan" }),
      params: [
        {
          key: "Width",
          name: "Width",
          kind: "FamilyParameter",
          isInstance: false,
          isBuiltIn: false,
          isProjectOnly: false,
          familyCount: 1,
        },
      ],
      pickedIds: new Set<number>(),
      setPickedIds: () => {},
      showUncommon: false,
      totalFamilies: 1,
      cells: {},
      propose: () => Promise.resolve(null),
    }),
  );
  expect(result.current.uncommonCount).toBe(0);
  expect(result.current.columns.find((column) => column.key === "Width")?.group).toBe("common");
  unmount();
});

import { expect, test, vi } from "vite-plus/test";
import { HostCallError } from "@pe/host-contracts/operation-types";
import { readGeometry } from "./geometry";

const refusal = (representation: string) =>
  new HostCallError("refused", 422, {
    kind: "over-budget",
    count: 101,
    ceiling: 100,
    representation,
    perSource: [{ source: 0, count: 101 }],
  });
const pane = () => ({
  overview: vi.fn(async () => "overview"),
  narrow: "Open fewer fans for full geometry.",
});

test("the requested representation succeeds without reading the overview", async () => {
  const declaration = pane();
  const capture = vi.fn(async () => "requested");
  expect(await readGeometry(declaration, "picked", "meshes", capture)).toEqual({
    value: "requested",
    notice: null,
  });
  expect(capture).toHaveBeenCalledExactlyOnceWith("meshes");
  expect(declaration.overview).not.toHaveBeenCalled();
});

test("mesh admission retries the same action as link-boxes with the reason named", async () => {
  const declaration = pane();
  const capture = vi.fn().mockRejectedValueOnce(refusal("meshes")).mockResolvedValueOnce("boxes");
  const result = await readGeometry(declaration, "picked", "meshes", capture);
  expect(capture.mock.calls).toEqual([["meshes"], ["link-boxes"]]);
  expect(result.value).toBe("boxes");
  expect(result.notice).toContain("(meshes): 101 > 100. Showing link boxes.");
  expect(declaration.overview).not.toHaveBeenCalled();
});

test.each(["meshes", "link-boxes"])(
  "%s refusal falls back to the declared overview",
  async (representation) => {
    const declaration = pane();
    const capture = vi.fn(async (rep: string) => {
      throw refusal(rep);
    });
    const result = await readGeometry(declaration, "picked", representation, capture);
    expect(result.value).toBe("overview");
    expect(result.notice).toContain("(link-boxes): 101 > 100.");
    expect(declaration.overview).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(representation === "meshes" ? 2 : 1);
  },
);

test("all reads only the declared overview, without attempting capture", async () => {
  const declaration = pane();
  const capture = vi.fn();
  expect((await readGeometry(declaration, "all", "meshes", capture)).value).toBe("overview");
  expect(capture).not.toHaveBeenCalled();
  expect(declaration.overview).toHaveBeenCalledTimes(1);
});

test("a generic error cannot be interpreted as admission or bypassed", async () => {
  const declaration = pane();
  await expect(
    readGeometry(declaration, "picked", "meshes", async () => {
      throw Error("over-budget");
    }),
  ).rejects.toThrow("over-budget");
  expect(declaration.overview).not.toHaveBeenCalled();
});

test("an overview refusal remains typed and has no override or further retry", async () => {
  const error = refusal("link-boxes");
  const declaration = {
    ...pane(),
    overview: vi.fn(async () => {
      throw error;
    }),
  };
  await expect(readGeometry(declaration, "all", "meshes", vi.fn())).rejects.toBe(error);
  expect(declaration.overview).toHaveBeenCalledTimes(1);
});

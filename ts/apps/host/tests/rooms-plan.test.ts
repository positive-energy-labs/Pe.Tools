import {expect,test} from "vite-plus/test";
import type {RevitContextViewImage} from "@pe/host-contracts/generated";
import {planOf} from "../src/reads/rooms-plan";
test("a plan draws only a paired URL and finite two-dimensional native registration", () => {
  const response: RevitContextViewImage.Res.Response = {
    view: { kind: "View", documentKey: "rooms", label: "Fixture level plan" },
    filePath: "rooms.png",
    byteSize: 1,
    width: 800,
    height: 480,
    registration: {
      width:800,height:480,
      imageSha256: "fixture-image",
      topLeft: [0, 24],
      topRight: [40, 24],
      bottomLeft: [0, 0],
    },
    imageUrl: "/captures/rooms.png",
    registrationRefusal: null,
  };
  expect(planOf(response)).toEqual({
    plan: { href: "/captures/rooms.png", registration: response.registration },
  });
  expect(
    planOf({ ...response, registration: null, imageUrl: null, registrationRefusal: "NoCrop" }),
  ).toEqual({ refusal: "NoCrop" });
  expect(() => planOf({ ...response, imageUrl: null })).toThrow("apart");
  expect(() => planOf({ ...response, registration: null })).toThrow("apart");
  expect(() =>
    planOf({ ...response, registration: { ...response.registration!, topLeft: [0, 0, 1] } }),
  ).toThrow("model XY");
  expect(() =>
    planOf({ ...response, registration: { ...response.registration!, topLeft: [NaN, 0] } }),
  ).toThrow("model XY");
});


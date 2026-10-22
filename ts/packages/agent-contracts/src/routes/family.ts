import { type RouteAddress } from "../route-field.ts";
import { demo, entityFields } from "./shared.ts";

export const familyAddress = {
  path: "/family",
  title: "Family",
  fields: {
    ...entityFields,
    demo,
  },
} satisfies RouteAddress;

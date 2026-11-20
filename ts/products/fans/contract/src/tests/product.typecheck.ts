import { product } from "../product.ts";

type FanEdit = (typeof product.tool.work.editable)[number];
const rated: FanEdit = ["ratedEsp", "*"];
// @ts-expect-error Required ESP has no Fans Work cell.
const esp: FanEdit = ["esp", "*"];
void [rated, esp];

import type { lossWrites } from "@pe/ducts-contract/product";
import { product } from "../product.ts";

type FanEdit = (typeof product.tool.work.editable)[number];
const rated: FanEdit = ["ratedEsp", "*"];
// @ts-expect-error Required ESP has no Fans Work cell.
const esp: FanEdit = ["esp", "*"];
void [rated, esp];

const { requiredEsp: _esp, ...missingHome } = product.commands["sheet.apply"].writes;
// @ts-expect-error The Fans apply request can write Required ESP even without an editable cell.
const incomplete: Record<keyof typeof lossWrites, readonly string[]> = missingHome;
void incomplete;

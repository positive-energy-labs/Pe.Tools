// Compiled by this package's `check`, never run: every `@ts-expect-error` is a declaration `tsc` must refuse.
import { product as define } from "@pe/agent-contracts/product";
import { product } from "../product.ts";

type Editable = (typeof product.work.editable)[number];
const staged: Editable = ["ceilingFt", "*"];
// @ts-expect-error a cell Pea may edit that the Work schema lacks
const drifted: Editable = ["esp", "*"];
const doc = product.work.schema.parse({});
const marks: Record<string, unknown> = doc.marks;
// @ts-expect-error the Work schema has no such cell either
const absent: unknown = doc.esp;

const write = product.commands["rooms.write"];
define({ ...product, commands: { "rooms.write": { ...write, writes: { regions: ["name"] } } } });
// @ts-expect-error a command whose writes names a cell the product lacks
define({ ...product, commands: { "rooms.write": { ...write, writes: { regions: ["esp"] } } } });
// @ts-expect-error a command whose writes names a home the product lacks
define({ ...product, commands: { "rooms.write": { ...write, writes: { carriers: [] } } } });
// @ts-expect-error a machine file holds no cell
define({ ...product, commands: { "rooms.write": { ...write, writes: { traces: ["name"] } } } });
// @ts-expect-error a reading whose source is no home of the product
define({ ...product, readings: { plans: { ...product.readings.plans, sources: ["carriers"] } } });
export const used = [staged, drifted, marks, absent];

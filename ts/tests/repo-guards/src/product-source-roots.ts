import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { routeFolderCandidates } from "@pe/web/route-startup";
import { ROOT } from "./import-census.ts";

export const productWebDirectories = () =>
  readdirSync(join(ROOT, "products")).map((product) => join(ROOT, "products", product, "web"));
export const routeModules = () =>
  routeFolderCandidates(join(ROOT, ".."))
    .map((dir) => join(dir, "route.ts"))
    .filter(existsSync)
    .map((file) => relative(ROOT, file).replaceAll("\\", "/"));
export const webConsumerDirectories = () => [
  ...new Set([
    ...routeFolderCandidates(join(ROOT, "..")).filter((dir) => existsSync(join(dir, "route.ts"))),
    ...productWebDirectories(),
  ]),
];

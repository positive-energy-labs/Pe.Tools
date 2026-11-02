import { field, text, manyField } from "../route-field.ts";
import { takeoffsAddress } from "./takeoffs.ts";
import { schedulesAddress } from "./schedules.ts";
export const zoneAuditAddress = {
  ...takeoffsAddress,
  path: "/zone-audit" as const,
  title: "Zone audit",
  fields: {
    ...takeoffsAddress.fields,
    views: manyField("UniqueId", { url: "push" }),
    zones: manyField("UniqueId", { url: "push" }),
    r10: field(text(4096), { url: "push" }),
  },
};
export const rhvacSyncAddress = {
  ...zoneAuditAddress,
  path: "/rhvac-sync" as const,
  title: "RHVAC sync",
};
export const scheduleSpecsAddress = {
  ...schedulesAddress,
  path: "/schedule-specs" as const,
  title: "Schedule definitions",
};
export const sessionAdminAddress = {
  path: "/session-admin" as const,
  title: "Sessions",
  fields: { session: field(text(), { url: "push" }) },
};

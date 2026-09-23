import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  canonicalRouteInput,
  diagnosticSchema,
  ffReceiptSchema,
  nativeProcessSchema,
  type ActionStep,
} from "@pe/agent-contracts";
import type { FamiliesApply } from "@pe/host-contracts/generated";

const inputSchema = z.object({
  operation: z.literal("families.apply"),
  plan: z.object({ actionId: z.string() }),
  expectedPlanHashes: z.record(z.string(), z.string()),
  familyNames: z.record(z.string(), z.string()),
  target: z.object({
    openId: z.string(),
    process: z.object({ processId: z.number(), processStartUtc: z.string() }),
  }),
  source: z.object({
    origin: z.string(),
    pod: z.string().nullable(),
    path: z.string(),
    sha256: z.string(),
  }),
  files: z.array(
    z.object({
      role: z.string(),
      address: z.string(),
      sha256: z.string(),
      file: z.string(),
    }),
  ),
});
const receiptSchema = z.object({
  operation: z.literal("families.apply"),
  outcome: z.literal("Succeeded"),
  planHash: z.string(),
  origin: z.string(),
  outputs: z.array(z.string()),
});
const responseSchema = z.object({
  receipts: z.array(ffReceiptSchema.passthrough()),
  diagnostics: z.array(diagnosticSchema.passthrough()),
  receiptPath: z.string().nullish(),
  reason: z.string().nullish(),
});

const lowerInitial = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key[0]!.toLowerCase() + key.slice(1), item]),
  );
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const json = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
};

/** A FF run is evidence only when one immutable run names the sealed input and original Revit lifetime. */
export async function familiesApplyRun(
  root: string,
  step: ActionStep,
  prepared: unknown,
  openId: string,
): Promise<{
  result: FamiliesApply.Res.Response;
  evidence: { run: string; input: unknown; receipt: unknown; apply: unknown };
} | null> {
  const basis = object(prepared);
  const request = object(basis?.input);
  const source = object(request?.source);
  const sourceRoot = object(source?.root);
  const process = nativeProcessSchema.safeParse(basis?.process);
  if (
    step.key !== "families.apply" ||
    !request ||
    !sourceRoot ||
    !process.success ||
    typeof request.plan !== "string" ||
    typeof request.specJson !== "string" ||
    !object(request.expectedPlanHashes) ||
    !object(request.familyNames)
  )
    return null;
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  const matching: { run: string; input: unknown }[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || !/^\d{8}-\d{6}-[a-f0-9]{32}$/.test(folder.name)) continue;
    const run = join(root, folder.name);
    const raw = await json(join(run, "input.json"));
    const input = inputSchema.safeParse(raw);
    if (!input.success) continue;
    const found = input.data;
    if (
      found.plan.actionId === request.plan &&
      found.target.openId === openId &&
      found.target.process.processId === process.data.pid &&
      Date.parse(found.target.process.processStartUtc) ===
        Date.parse(process.data.processStartUtc) &&
      canonicalRouteInput(found.expectedPlanHashes) ===
        canonicalRouteInput(request.expectedPlanHashes) &&
      canonicalRouteInput(found.familyNames) === canonicalRouteInput(request.familyNames) &&
      found.source.origin === sourceRoot.origin &&
      found.source.pod === sourceRoot.id &&
      found.source.path === sourceRoot.path &&
      found.source.sha256 === sourceRoot.sha256 &&
      (await readFile(join(run, "effective-input.json"), "utf8").catch(() => null)) ===
        request.specJson &&
      found.files.some(
        (file) =>
          file.role === (sourceRoot.origin === "SavedMember" ? "saved-member" : "supplied-draft") &&
          file.address === sourceRoot.path &&
          file.sha256 === sourceRoot.sha256 &&
          /^source\/00-[^/\\]+$/.test(file.file),
      ) &&
      (
        await Promise.all(
          found.files
            .filter((file) => /^source\/00-[^/\\]+$/.test(file.file))
            .map(async (file) => {
              const bytes = await readFile(join(run, file.file)).catch(() => null);
              return (
                bytes &&
                createHash("sha256").update(bytes).digest("hex") === sourceRoot.sha256 &&
                bytes.equals(Buffer.from(String(sourceRoot.bytesBase64), "base64"))
              );
            }),
        )
      ).some(Boolean)
    )
      matching.push({ run, input: raw });
  }
  if (matching.length !== 1) return null;
  const { run, input } = matching[0]!;
  const rawReceipt = await json(join(run, "receipt.json"));
  const receipt = receiptSchema.safeParse(rawReceipt);
  const rawApply = await json(join(run, "apply.json"));
  const apply = object(rawApply);
  if (
    !receipt.success ||
    !receipt.data.outputs.includes("input.json") ||
    !receipt.data.outputs.includes("apply.json") ||
    receipt.data.origin !== sourceRoot.origin ||
    !apply ||
    !Array.isArray(apply.Receipts) ||
    !Array.isArray(apply.Diagnostics)
  )
    return null;
  const normalized = responseSchema.safeParse({
    receipts: apply.Receipts.map((row) => {
      const fields = object(row);
      if (!fields || !Array.isArray(fields.Residue)) return null;
      return {
        ...lowerInitial(fields),
        residue: fields.Residue.map((change) =>
          object(change) ? lowerInitial(object(change)!) : null,
        ),
      };
    }),
    diagnostics: apply.Diagnostics.map((row) => (object(row) ? lowerInitial(object(row)!) : null)),
    receiptPath: join(run, "receipt.json"),
    reason: apply.Reason,
  });
  if (!normalized.success) return null;
  const expected = request.expectedPlanHashes as Record<string, string>;
  const names = request.familyNames as Record<string, string>;
  const rows = normalized.data.receipts;
  if (
    !rows.some((row) => row.success) ||
    rows.length !== Object.keys(expected).length ||
    rows.some(
      (row) =>
        expected[String(row.familyId)] !== row.planHash ||
        names[String(row.familyId)] !== row.familyName,
    ) ||
    receipt.data.planHash !== [...new Set(rows.map((row) => row.planHash))].join(",")
  )
    return null;
  return {
    result: {
      ...normalized.data,
      receipts: rows.map((row) => ({
        ...row,
        artifactDirectory: row.artifactDirectory ? run : null,
      })),
    } as FamiliesApply.Res.Response,
    evidence: { run, input, receipt: rawReceipt, apply: rawApply },
  };
}

export const isFamiliesApplyResponse = (value: unknown): value is FamiliesApply.Res.Response =>
  responseSchema.safeParse(value).success;

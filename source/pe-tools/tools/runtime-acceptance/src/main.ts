import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { acceptancePlan, type AcceptanceProfile } from "./contract.ts";

export * from "./contract.ts";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const profile = option(args, "--profile", "deterministic") as AcceptanceProfile;
  if (profile !== "deterministic" && profile !== "showcase")
    throw new Error("--profile must be deterministic or showcase");
  if (args.includes("--plan")) {
    process.stdout.write(
      `${JSON.stringify({ profile, gates: acceptancePlan(profile) }, null, 2)}\n`,
    );
  } else {
    const { runAcceptance } = await import("./runner.ts");
    await runAcceptance({
      profile,
      year: Number(option(args, "--year", "2025")),
      evidence: optionOptional(args, "--evidence"),
      sdkRoot: optionOptional(args, "--sdk-root"),
      allowDirty: args.includes("--allow-dirty"),
    });
  }
}

function optionOptional(args: readonly string[], name: string): string | undefined {
  return args.includes(name) ? option(args, name) : undefined;
}

function option(args: readonly string[], name: string, fallback?: string): string {
  const index = args.indexOf(name);
  if (index < 0) {
    if (fallback === undefined) throw new Error(`missing ${name}`);
    return fallback;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

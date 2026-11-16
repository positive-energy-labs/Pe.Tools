import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { CommandFailure } from "../../../../packages/agent-contracts/src/command-authority.ts";
import { json } from "./model.ts";

/** An exact byte closure. The composition owner supplies complete sealed artifact directories, not versions. */
export class CommandClosure {
  private constructor(
    readonly identity: string,
    readonly verify: Effect.Effect<void, CommandFailure>,
  ) {}

  static seal(
    roots: readonly string[],
    effectiveConfiguration: unknown,
  ): Effect.Effect<CommandClosure, CommandFailure> {
    const configuration = json(effectiveConfiguration);
    const digest = () => {
      if (!roots.length) throw Error("Empty executable closure");
      const hash = createHash("sha256").update(configuration);
      const seen = new Set<string>();
      const walk = (path: string) => {
        const actual = realpathSync(path);
        if (seen.has(actual)) return;
        seen.add(actual);
        const stat = statSync(actual);
        hash.update(json([path, actual]));
        if (stat.isDirectory()) {
          for (const name of readdirSync(actual).sort()) walk(join(path, name));
        } else if (stat.isFile()) {
          const bytes = readFileSync(actual);
          hash.update(json([bytes.length]));
          hash.update(bytes);
        } else throw Error("Unsupported closure member");
      };
      // Actual answering runtime bytes are part of every source and installed closure.
      for (const path of [...new Set([process.execPath, ...roots.map((p) => resolve(p))])].sort())
        walk(path);
      return hash.digest("hex");
    };
    return Effect.try({
      try: digest,
      catch: () => new CommandFailure({ problem: "incompatible", ref: null }),
    }).pipe(
      Effect.map(
        (identity) =>
          new CommandClosure(
            identity,
            Effect.try({
              try: () => {
                if (digest() !== identity) throw Error("Executable bytes changed");
              },
              catch: () => new CommandFailure({ problem: "incompatible", ref: null }),
            }),
          ),
      ),
    );
  }
}

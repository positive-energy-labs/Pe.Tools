import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Schema } from "effect";
import {
  CommandFailure,
  Generation,
} from "../../../../packages/agent-contracts/src/command-authority.ts";

const Fence = Schema.Struct({
  state: Schema.Literal("Active"),
  generation: Generation,
  databaseId: Schema.String,
});
const decode = Schema.decodeUnknownSync(Fence);
const closed = () => new CommandFailure({ problem: "unavailable", ref: null });
const durableCreate = (path: string, body: string) => {
  const fd = openSync(path, "wx");
  try {
    writeFileSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

/** Fail-closed custody. A crash leaves the lock; no age/PID guess automatically grants successor authority. */
export const engineCustody = (directory: string, operation: "open" | "provision") =>
  Effect.gen(function* () {
    const lock = join(directory, "custody");
    yield* Effect.try({ try: () => mkdirSync(directory, { recursive: true }), catch: closed });
    yield* Effect.acquireRelease(Effect.try({ try: () => mkdirSync(lock), catch: closed }), () =>
      Effect.sync(() => rmdirSync(lock)),
    );
    return yield* Effect.try({
      try: () => {
        const path = join(directory, "fence.json");
        if (operation === "provision") {
          // Explicit virgin provisioning never adopts an existing database, including restored old bytes.
          if (
            existsSync(path) ||
            existsSync(join(directory, "active.db")) ||
            existsSync(join(directory, "provision.pending"))
          )
            throw closed();
          const generation = Generation.make(randomUUID());
          const databaseId = randomUUID();
          const fence = { state: "Active" as const, generation, databaseId };
          durableCreate(join(directory, "provision.pending"), JSON.stringify(fence));
          const db = new DatabaseSync(join(directory, "active.db"));
          try {
            db.exec("PRAGMA synchronous=FULL");
            db.exec(
              "CREATE TABLE command_header (generation TEXT NOT NULL, database_id TEXT NOT NULL)",
            );
            db.prepare("INSERT INTO command_header VALUES (?,?)").run(generation, databaseId);
          } finally {
            db.close();
          }
          // A cut before this create keeps admission closed. No implicit startup provisioning.
          durableCreate(path, JSON.stringify(fence));
        }
        const fence = decode(JSON.parse(readFileSync(path, "utf8")));
        const filename = join(directory, "active.db");
        const db = new DatabaseSync(filename, { readOnly: true });
        try {
          const rows = db.prepare("SELECT generation,database_id FROM command_header").all();
          if (
            rows.length !== 1 ||
            rows[0].generation !== fence.generation ||
            rows[0].database_id !== fence.databaseId
          )
            throw closed();
        } finally {
          db.close();
        }
        return { ...fence, filename };
      },
      catch: closed,
    });
  });

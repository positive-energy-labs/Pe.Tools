import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { parse } from "smol-toml";

type Config = {
  factory: { ref: string; poll_seconds: number; port: number; db: string };
  sensor: Record<string, { run: string; scope: string[] }>;
  loop: Record<string, { sense: string[]; setpoint: Record<string, string> }>;
};

type EventRow = {
  seq: number;
  ts: string;
  id: string | null;
  loop: string | null;
  kind: string;
  sha: string;
  payload: string;
};

const schema = `CREATE TABLE IF NOT EXISTS events(
  seq INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  id TEXT UNIQUE,
  loop TEXT,
  kind TEXT NOT NULL,
  sha TEXT NOT NULL,
  payload TEXT NOT NULL
)`;

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

const configAt = (repo: string) =>
  parse(readFileSync(join(repo, "factory.toml"), "utf8")) as Config;

const openDatabase = (repo: string, config: Config) => {
  const path = resolve(repo, config.factory.db);
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(schema);
  return database;
};

const append = (
  database: DatabaseSync,
  kind: string,
  sha: string,
  payload: object,
  loop: string | null = null,
  id: string | null = null,
) =>
  database
    .prepare(
      "INSERT OR IGNORE INTO events(ts, id, loop, kind, sha, payload) VALUES(?, ?, ?, ?, ?, ?)",
    )
    .run(new Date().toISOString(), id, loop, kind, sha, JSON.stringify(payload));

const rows = (database: DatabaseSync, since = 0) =>
  database.prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq").all(since) as EventRow[];

const readValues = (database: DatabaseSync, sensor: string, sha: string) => {
  const row = database
    .prepare("SELECT payload FROM events WHERE id = ?")
    .get(`${sensor}@${sha}`) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as { values: Record<string, number> }).values : undefined;
};

const latestValues = (database: DatabaseSync, sensor: string, before = Number.MAX_SAFE_INTEGER) => {
  const row = database
    .prepare(
      "SELECT payload FROM events WHERE kind = 'reading' AND seq < ? AND json_extract(payload, '$.sensor') = ? ORDER BY seq DESC LIMIT 1",
    )
    .get(before, sensor) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as { values: Record<string, number> }).values : undefined;
};

const sense = (
  repo: string,
  config: Config,
  database: DatabaseSync,
  sha: string,
  previous?: string,
) => {
  const changed = previous
    ? git(repo, "diff", "--name-only", previous, sha).split(/\r?\n/).filter(Boolean)
    : [];
  const sensors = [...new Set(Object.values(config.loop).flatMap((loop) => loop.sense))];
  const checkout = join(repo, ".artifacts", "factory", "checkouts", sha.slice(0, 7));

  try {
    for (const name of sensors) {
      if (readValues(database, name, sha)) continue;
      const sensor = config.sensor[name];
      if (!sensor) {
        append(database, "failed", sha, { sensor: name, stderr: "sensor is not declared" });
        continue;
      }
      const retry = database
        .prepare(
          "SELECT 1 FROM events WHERE kind = 'failed' AND sha = ? AND json_extract(payload, '$.sensor') = ? LIMIT 1",
        )
        .get(sha, name);
      if (
        previous &&
        !retry &&
        !changed.some((file) => sensor.scope.some((glob) => matchesGlob(file, glob)))
      ) {
        continue;
      }

      try {
        mkdirSync(dirname(checkout), { recursive: true });
        if (!existsSync(checkout)) {
          execFileSync("git", ["-C", repo, "worktree", "add", "--detach", checkout, sha], {
            stdio: "ignore",
          });
        }
        if (git(checkout, "rev-parse", "HEAD") !== sha || git(checkout, "status", "--porcelain")) {
          throw new Error(`checkout is not clean at ${sha}`);
        }

        const env: NodeJS.ProcessEnv = { ...process.env, FACTORY_ROOT: repo, FACTORY_SHA: sha };
        delete env.ANTHROPIC_API_KEY;
        delete env.ANTHROPIC_AUTH_TOKEN;
        delete env.OPENAI_API_KEY;
        const root = `"${repo.replaceAll("\\", "/")}"`;
        const result = spawnSync(sensor.run.replaceAll("{root}", root), {
          cwd: checkout,
          encoding: "utf8",
          env,
          shell: true,
        });
        if (result.status !== 0)
          throw new Error(result.stderr.trim() || `sensor exited ${result.status}`);
        const values: unknown = JSON.parse(result.stdout.trim());
        if (
          !values ||
          Array.isArray(values) ||
          typeof values !== "object" ||
          Object.values(values).some(
            (value) => typeof value !== "number" || !Number.isFinite(value),
          )
        ) {
          throw new Error("sensor stdout is not one flat JSON object of numbers");
        }
        append(database, "reading", sha, { sensor: name, values }, null, `${name}@${sha}`);
      } catch (error) {
        append(database, "failed", sha, {
          sensor: name,
          stderr: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    if (existsSync(checkout)) {
      execFileSync("git", ["-C", repo, "worktree", "remove", "--force", checkout]);
    }
  }
};

const errors = (
  config: Config,
  database: DatabaseSync,
  sha: string,
  previous: string | undefined,
) => {
  const first = database.prepare("SELECT min(seq) seq FROM events WHERE sha = ?").get(sha) as {
    seq: number | null;
  };
  for (const [loopName, loop] of Object.entries(config.loop)) {
    const values: Record<string, number | null> = {};
    for (const [key, setpoint] of Object.entries(loop.setpoint)) {
      const dot = key.indexOf(".");
      const sensor = key.slice(0, dot);
      const field = key.slice(dot + 1);
      const current = readValues(database, sensor, sha)?.[field];
      const prior = previous
        ? latestValues(database, sensor, first.seq ?? Number.MAX_SAFE_INTEGER)?.[field]
        : undefined;
      const failed = database
        .prepare(
          "SELECT 1 FROM events WHERE kind = 'failed' AND sha = ? AND json_extract(payload, '$.sensor') = ? LIMIT 1",
        )
        .get(sha, sensor);
      const value = current ?? prior;
      if (failed && current === undefined) values[key] = null;
      else if (value === undefined || setpoint === "any") values[key] = 0;
      else if (setpoint === "down")
        values[key] = prior === undefined ? 0 : Math.max(0, value - prior);
      else if (setpoint.startsWith("<="))
        values[key] = Math.max(0, value - Number(setpoint.slice(2)));
      else if (setpoint.startsWith(">="))
        values[key] = Math.max(0, Number(setpoint.slice(2)) - value);
      else values[key] = 0;
    }
    append(database, "error", sha, { loop: loopName, values }, loopName);
  }
};

export function tick(repo: string, suppliedDatabase?: DatabaseSync) {
  const config = configAt(repo);
  const database = suppliedDatabase ?? openDatabase(repo, config);
  try {
    const sha = git(repo, "rev-parse", config.factory.ref);
    const latest = database
      .prepare(
        "SELECT sha FROM events WHERE kind = 'triggered' AND json_extract(payload, '$.ref') = ? ORDER BY seq DESC LIMIT 2",
      )
      .all(config.factory.ref) as { sha: string }[];
    const pending = database
      .prepare(
        "SELECT 1 FROM events failed WHERE kind = 'failed' AND sha = ? AND json_extract(payload, '$.sensor') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM events reading WHERE reading.id = json_extract(failed.payload, '$.sensor') || '@' || ?) LIMIT 1",
      )
      .get(sha, sha);
    if (latest[0]?.sha === sha && !pending) return;
    const previous = latest[0]?.sha === sha ? latest[1]?.sha : latest[0]?.sha;
    sense(repo, config, database, sha, previous);
    errors(config, database, sha, previous);
    if (latest[0]?.sha !== sha) append(database, "triggered", sha, { ref: config.factory.ref });
  } finally {
    if (!suppliedDatabase) database.close();
  }
}

const projection = (database: DatabaseSync, config: Config, repo: string) => {
  const order = new Map(
    git(repo, "rev-list", "--first-parent", "--reverse", config.factory.ref)
      .split(/\r?\n/)
      .map((sha, index) => [sha, index]),
  );
  const readings = rows(database)
    .filter((row) => row.kind === "reading")
    .map((row) => ({ sha: row.sha, ...(JSON.parse(row.payload) as object) }))
    .sort(
      (a, b) =>
        (order.get(a.sha) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.sha) ?? Number.MAX_SAFE_INTEGER),
    );
  const loops = Object.keys(config.loop).flatMap((loop) => {
    const row = database
      .prepare("SELECT * FROM events WHERE kind = 'error' AND loop = ? ORDER BY seq DESC LIMIT 1")
      .get(loop) as EventRow | undefined;
    return row
      ? [{ loop, sha: row.sha, values: (JSON.parse(row.payload) as { values: object }).values }]
      : [];
  });
  return {
    readings,
    loops,
    setpoints: Object.fromEntries(
      Object.entries(config.loop).map(([loop, value]) => [loop, value.setpoint]),
    ),
  };
};

const sendJson = (response: ServerResponse, value: unknown) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const serve = (repo: string, config: Config, database: DatabaseSync) =>
  createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const since = Math.max(0, Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0);
    if (request.method !== "GET") {
      response.writeHead(405).end();
    } else if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(readFileSync(new URL("./ui/index.html", import.meta.url), "utf8"));
    } else if (url.pathname === "/events.json") {
      sendJson(response, rows(database, since));
    } else if (url.pathname === "/state") {
      sendJson(response, projection(database, config, repo));
    } else if (url.pathname === "/events") {
      response.writeHead(200, {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      });
      let cursor = since;
      const flush = () => {
        for (const row of rows(database, cursor)) {
          response.write(`id: ${row.seq}\ndata: ${JSON.stringify(row)}\n\n`);
          cursor = row.seq;
        }
      };
      flush();
      const timer = setInterval(flush, 1_000);
      request.on("close", () => clearInterval(timer));
    } else {
      response.writeHead(404).end();
    }
  });

function main() {
  const args = process.argv.slice(2);
  const repoIndex = args.indexOf("--repo");
  if (repoIndex >= 0 && !args[repoIndex + 1]) throw new Error("--repo requires a path");
  const repo = resolve(repoIndex >= 0 ? args[repoIndex + 1]! : process.cwd());
  const config = configAt(repo);
  if (args.includes("--once")) {
    tick(repo);
    return;
  }

  const database = openDatabase(repo, config);
  tick(repo, database);
  const server = serve(repo, config, database);
  server.listen(config.factory.port, () =>
    console.log(`factory listening on http://localhost:${config.factory.port}`),
  );
  const timer = setInterval(() => {
    try {
      tick(repo, database);
    } catch (error) {
      console.error(error);
    }
  }, config.factory.poll_seconds * 1_000);
  const stop = () => {
    clearInterval(timer);
    server.close(() => database.close());
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

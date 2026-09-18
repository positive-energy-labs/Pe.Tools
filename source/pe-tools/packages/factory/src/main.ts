import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { dirname, join, matchesGlob, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { parse } from "smol-toml";

type Config = {
  factory: { ref: string; poll_seconds: number; port: number; db: string; host?: string };
  sensor: Record<string, { run: string; scope: string[] }>;
  actuator?: Record<string, { run: string; review?: string }>;
  loop: Record<
    string,
    {
      on?: string;
      sense?: string[];
      setpoint?: Record<string, string>;
      act?: string;
      gate?: "auto" | "human";
    }
  >;
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

// ponytail: 8 MiB makes chatty commands explicit; stream to artifacts if commands outgrow it.
const maxBuffer = 8 * 1024 * 1024;

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

const samePath = (left: string, right: string) =>
  normalize(resolve(left)).toLowerCase() === normalize(resolve(right)).toLowerCase();

const isRunWorktree = (worktree: string) => {
  try {
    return samePath(git(worktree, "rev-parse", "--show-toplevel"), worktree);
  } catch {
    return false;
  }
};

const requireRunWorktree = (worktree: string) => {
  if (!isRunWorktree(worktree)) throw new Error("run worktree escaped its path");
};

const cleanupRun = (repo: string, branch: string, worktree: string) => {
  try {
    if (existsSync(worktree)) {
      execFileSync("git", ["-C", repo, "worktree", "remove", "--force", worktree]);
    }
  } catch {
    rmSync(worktree, { recursive: true, force: true });
  }
  try {
    git(repo, "worktree", "prune");
    git(repo, "branch", "-D", branch);
  } catch {
    // Cleanup never changes the recorded run outcome.
  }
};

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

const captured = (name: "stdout" | "stderr", value: string) => {
  // ponytail: 64 KiB keeps SQLite inspectable; move large streams to artifacts if real actuators need them.
  const bytes = Buffer.from(value);
  return bytes.length <= 65_536
    ? { [name]: value }
    : { [name]: bytes.subarray(0, 65_536).toString("utf8"), [`${name}Truncated`]: true };
};

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

const loopPaused = (database: DatabaseSync, loop: string) =>
  (
    database
      .prepare(
        "SELECT kind FROM events WHERE loop = ? AND kind IN ('paused','resumed') ORDER BY seq DESC LIMIT 1",
      )
      .get(loop) as { kind: string } | undefined
  )?.kind === "paused";

const sense = (
  repo: string,
  config: Config,
  database: DatabaseSync,
  sha: string,
  previous?: string,
  force = false,
) => {
  const changed = previous
    ? git(repo, "diff", "--name-only", previous, sha).split(/\r?\n/).filter(Boolean)
    : [];
  const sensors = [...new Set(Object.values(config.loop).flatMap((loop) => loop.sense ?? []))];
  const checkout = join(repo, ".artifacts", "factory", "checkouts", sha.slice(0, 7));

  try {
    for (const name of sensors) {
      if (readValues(database, name, sha)) continue;
      const sensor = config.sensor[name];
      if (!sensor) {
        append(
          database,
          "failed",
          sha,
          { sensor: name, ...captured("stderr", "sensor is not declared") },
          null,
          `failed:${name}@${sha}`,
        );
        continue;
      }
      const retry = database
        .prepare(
          "SELECT 1 FROM events WHERE kind = 'failed' AND sha = ? AND json_extract(payload, '$.sensor') = ? LIMIT 1",
        )
        .get(sha, name);
      if (
        !force &&
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
          maxBuffer,
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
        append(
          database,
          "reading",
          sha,
          {
            sensor: name,
            values,
            ...(result.stderr ? captured("stderr", result.stderr) : {}),
          },
          null,
          `${name}@${sha}`,
        );
      } catch (error) {
        append(
          database,
          "failed",
          sha,
          {
            sensor: name,
            ...captured("stderr", error instanceof Error ? error.message : String(error)),
          },
          null,
          `failed:${name}@${sha}`,
        );
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
  id = null as string | null,
) => {
  for (const [loopName, loop] of Object.entries(config.loop)) {
    const values: Record<string, number | null> = {};
    for (const [key, setpoint] of Object.entries(loop.setpoint ?? {})) {
      const dot = key.indexOf(".");
      const sensor = key.slice(0, dot);
      const field = key.slice(dot + 1);
      const current = readValues(database, sensor, sha)?.[field];
      const prior = previous ? readValues(database, sensor, previous)?.[field] : undefined;
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
    append(
      database,
      "error",
      sha,
      { loop: loopName, values },
      loopName,
      id && `${id}:${loopName}@${sha}`,
    );
  }
};

export function backfill(repo: string, count: number, suppliedDatabase?: DatabaseSync) {
  const config = configAt(repo);
  const database = suppliedDatabase ?? openDatabase(repo, config);
  try {
    const commits = git(
      repo,
      "rev-list",
      "--first-parent",
      "--reverse",
      `--max-count=${count}`,
      config.factory.ref,
    )
      .split(/\r?\n/)
      .filter(Boolean);
    for (const sha of commits) {
      const parent = git(repo, "rev-list", "--parents", "-n", "1", sha).split(" ")[1];
      sense(repo, config, database, sha, parent);
      errors(config, database, sha, parent, "backfill");
    }
  } finally {
    if (!suppliedDatabase) database.close();
  }
}

const mergeRun = (
  repo: string,
  config: Config,
  database: DatabaseSync,
  loop: string,
  sha: string,
  actuator: string,
  branch: string,
  worktree: string,
) => {
  const fail = (stderr: string) => {
    append(database, "failed", sha, { actuator, stderr }, loop);
    cleanupRun(repo, branch, worktree);
    return false;
  };
  if (git(repo, "rev-parse", "--abbrev-ref", "HEAD") !== config.factory.ref) {
    return fail("ref not checked out in factory tree");
  }
  if (git(repo, "rev-parse", config.factory.ref) !== sha) return fail("ref moved");
  try {
    git(repo, "merge", "--no-ff", "--no-edit", branch);
  } catch (error) {
    try {
      git(repo, "merge", "--abort");
    } catch {
      // Git has no merge to abort when it failed before writing merge state.
    }
    return fail(error instanceof Error ? error.message : String(error));
  }
  const merge = git(repo, "rev-parse", "HEAD");
  append(database, "merged", sha, { merge }, loop);
  cleanupRun(repo, branch, worktree);
  return true;
};

const act = (
  repo: string,
  config: Config,
  database: DatabaseSync,
  loopName: string,
  loop: Config["loop"][string],
  sha: string,
  force = false,
) => {
  if (!loop.act) return false;
  if (loopPaused(database, loopName)) return false;
  const branch = `factory/${loopName}/${sha.slice(0, 7)}`;
  const worktree = join(repo, ".artifacts", "factory", "runs", `${loopName}-${sha.slice(0, 7)}`);
  const fail = (actuator: string, stderr: string, stdout = "") => {
    append(
      database,
      "failed",
      sha,
      { actuator, ...captured("stdout", stdout), ...captured("stderr", stderr) },
      loopName,
    );
    cleanupRun(repo, branch, worktree);
    return false;
  };
  const actuator = config.actuator?.[loop.act];
  if (!actuator) {
    return fail(loop.act, "actuator is not declared");
  }
  const runEvents = database
    .prepare(
      "SELECT * FROM events WHERE loop = ? AND sha = ? AND kind IN ('acting','proposed','gated','verdict','merged','failed') ORDER BY seq",
    )
    .all(loopName, sha) as EventRow[];
  const last = runEvents.at(-1);
  const lastPayload = last ? (JSON.parse(last.payload) as Record<string, string>) : {};
  if (last?.kind === "verdict" && lastPayload.decision === "accept") {
    return mergeRun(repo, config, database, loopName, sha, loop.act, branch, worktree);
  }
  if (
    last?.kind !== "verdict" &&
    runEvents.some((event) => ["proposed", "merged", "failed"].includes(event.kind))
  ) {
    return false;
  }
  if (!force && last?.kind !== "verdict") {
    const error = database
      .prepare(
        "SELECT payload FROM events WHERE kind = 'error' AND loop = ? AND sha = ? ORDER BY seq DESC LIMIT 1",
      )
      .get(loopName, sha) as { payload: string } | undefined;
    const values = error
      ? (JSON.parse(error.payload) as { values: Record<string, number | null> }).values
      : {};
    if (loop.sense?.length && !Object.values(values).some((value) => value !== null && value > 0)) {
      return false;
    }
  }

  const feedback = last?.kind === "verdict" ? lastPayload.text : "";
  mkdirSync(dirname(worktree), { recursive: true });
  try {
    const reuse = existsSync(worktree) && isRunWorktree(worktree);
    if (existsSync(worktree) && !reuse) {
      rmSync(worktree, { recursive: true, force: true });
      git(repo, "worktree", "prune");
    }
    if (reuse) {
      requireRunWorktree(worktree);
      git(worktree, "reset", "--hard", sha);
      git(worktree, "clean", "-fd");
    } else {
      git(repo, "worktree", "add", "-B", branch, worktree, sha);
    }
    requireRunWorktree(worktree);
    append(database, "acting", sha, { actuator: loop.act, worktree, branch }, loopName);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FACTORY_FEEDBACK: feedback,
      FACTORY_LOOP: loopName,
      FACTORY_ROOT: repo,
      FACTORY_SHA: sha,
    };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.OPENAI_API_KEY;
    const root = `"${repo.replaceAll("\\", "/")}"`;
    const result = spawnSync(actuator.run.replaceAll("{root}", root), {
      cwd: worktree,
      encoding: "utf8",
      env,
      maxBuffer,
      shell: true,
    });
    if (result.status !== 0) {
      return fail(
        loop.act,
        result.stderr.trim() || `actuator exited ${result.status}`,
        result.stdout,
      );
    }
    if (!git(worktree, "status", "--porcelain")) {
      return fail(
        loop.act,
        `actuator changed nothing${result.stderr ? `\n${result.stderr}` : ""}`,
        result.stdout,
      );
    }
    requireRunWorktree(worktree);
    git(worktree, "add", "-A");
    requireRunWorktree(worktree);
    git(worktree, "commit", "-m", `factory: ${loopName} at ${sha.slice(0, 7)}`);
    const head = git(worktree, "rev-parse", "HEAD");
    const shortstat = git(worktree, "diff", "--shortstat", `${sha}..${head}`);
    append(
      database,
      "proposed",
      sha,
      {
        branch,
        head,
        shortstat,
        ...captured("stdout", result.stdout),
        ...captured("stderr", result.stderr),
      },
      loopName,
    );
    if (loop.gate === "human") {
      append(database, "gated", sha, {}, loopName);
      return false;
    }
    return mergeRun(repo, config, database, loopName, sha, loop.act, branch, worktree);
  } catch (error) {
    return fail(loop.act, error instanceof Error ? error.message : String(error));
  }
};

export function recordVerdict(
  database: DatabaseSync,
  body: { run: string; decision: "accept" | "reject"; text: string },
) {
  const at = body.run.lastIndexOf("@");
  const loop = body.run.slice(0, at);
  const sha = body.run.slice(at + 1);
  if (
    at < 1 ||
    !["accept", "reject"].includes(body.decision) ||
    typeof body.text !== "string" ||
    (body.decision === "reject" && !body.text.trim())
  ) {
    throw new Error("invalid verdict");
  }
  const last = database
    .prepare(
      "SELECT * FROM events WHERE loop = ? AND sha = ? AND kind IN ('acting','proposed','gated','verdict','merged','failed') ORDER BY seq DESC LIMIT 1",
    )
    .get(loop, sha) as EventRow | undefined;
  if (last?.kind !== "gated") throw new Error("run is not gated");
  append(database, "verdict", sha, { decision: body.decision, text: body.text }, loop);
  return database.prepare("SELECT * FROM events ORDER BY seq DESC LIMIT 1").get() as EventRow;
}

export function setLoopPaused(
  repo: string,
  loop: string,
  paused: boolean,
  suppliedDatabase?: DatabaseSync,
) {
  const config = configAt(repo);
  if (!config.loop[loop]) throw new Error(`unknown loop: ${loop}`);
  const database = suppliedDatabase ?? openDatabase(repo, config);
  try {
    append(
      database,
      paused ? "paused" : "resumed",
      git(repo, "rev-parse", config.factory.ref),
      {},
      loop,
    );
  } finally {
    if (!suppliedDatabase) database.close();
  }
}

export function tick(repo: string, suppliedDatabase?: DatabaseSync) {
  const lock = join(repo, ".artifacts", "factory", "tick.lock");
  mkdirSync(dirname(lock), { recursive: true });
  let lockFile: number;
  try {
    lockFile = openSync(lock, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      console.log("factory tick skipped: lock held");
      return;
    }
    throw error;
  }
  let database: DatabaseSync | undefined;
  try {
    const config = configAt(repo);
    database = suppliedDatabase ?? openDatabase(repo, config);
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
    if (latest[0]?.sha !== sha || pending) {
      const previous = latest[0]?.sha === sha ? latest[1]?.sha : latest[0]?.sha;
      sense(repo, config, database, sha, previous);
      errors(config, database, sha, previous);
      if (latest[0]?.sha !== sha) append(database, "triggered", sha, { ref: config.factory.ref });
    }
    for (const [loopName, loop] of Object.entries(config.loop)) {
      if (act(repo, config, database, loopName, loop, sha)) break;
    }
    const accepted = database
      .prepare(
        "SELECT verdict.loop, verdict.sha, (SELECT json_extract(acting.payload, '$.actuator') FROM events acting WHERE acting.loop = verdict.loop AND acting.sha = verdict.sha AND acting.kind = 'acting' ORDER BY acting.seq DESC LIMIT 1) actuator FROM events verdict WHERE verdict.kind = 'verdict' AND json_extract(verdict.payload, '$.decision') = 'accept' AND NOT EXISTS (SELECT 1 FROM events later WHERE later.loop = verdict.loop AND later.sha = verdict.sha AND later.seq > verdict.seq AND later.kind IN ('acting','proposed','gated','verdict','merged','failed')) ORDER BY verdict.seq",
      )
      .all() as { loop: string; sha: string; actuator: string }[];
    for (const run of accepted) {
      if (loopPaused(database, run.loop)) continue;
      mergeRun(
        repo,
        config,
        database,
        run.loop,
        run.sha,
        run.actuator,
        `factory/${run.loop}/${run.sha.slice(0, 7)}`,
        join(repo, ".artifacts", "factory", "runs", `${run.loop}-${run.sha.slice(0, 7)}`),
      );
    }
  } finally {
    if (!suppliedDatabase) database?.close();
    closeSync(lockFile);
    unlinkSync(lock);
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
    .map((row) => ({ sha: row.sha, ts: row.ts, ...(JSON.parse(row.payload) as object) }))
    .sort(
      (a, b) =>
        (order.get(a.sha) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.sha) ?? Number.MAX_SAFE_INTEGER),
    );
  const runKinds = new Set(["acting", "proposed", "gated", "verdict", "merged", "failed"]);
  const loops = Object.entries(config.loop).map(([loop, declaration]) => {
    const error = database
      .prepare("SELECT * FROM events WHERE kind = 'error' AND loop = ? ORDER BY seq DESC LIMIT 1")
      .get(loop) as EventRow | undefined;
    const run = rows(database)
      .filter((row) => row.loop === loop && runKinds.has(row.kind))
      .at(-1);
    const data = run ? (JSON.parse(run.payload) as Record<string, string>) : {};
    const merged = database
      .prepare(
        "SELECT sha FROM events WHERE kind = 'merged' AND loop = ? ORDER BY seq DESC LIMIT 1",
      )
      .get(loop) as { sha: string } | undefined;
    const values = error
      ? (JSON.parse(error.payload) as { values: Record<string, number | null> }).values
      : {};
    const deltas = Object.fromEntries(
      Object.entries(declaration.setpoint ?? {}).map(([key, setpoint]) => {
        const [sensor, field] = key.split(".");
        const current = error ? latestValues(database, sensor, error.seq + 1)?.[field] : undefined;
        const baseline = merged ? readValues(database, sensor, merged.sha)?.[field] : undefined;
        const value = current === undefined || baseline === undefined ? null : current - baseline;
        const wrong =
          value !== null &&
          (setpoint === "down" || setpoint.startsWith("<=")
            ? value > 0
            : setpoint.startsWith(">=") && value < 0);
        return [key, { value, wrong }];
      }),
    );
    return {
      loop,
      sha: error?.sha,
      measured: error ? { ts: error.ts, sha: error.sha } : null,
      values,
      deltas,
      state: loopPaused(database, loop) ? "paused" : (run?.kind ?? "idle"),
      lastRun: run ? { ts: run.ts, sha: run.sha } : null,
      next: `on merge:${config.factory.ref}`,
      stderr: run?.kind === "failed" ? data.stderr?.split(/\r?\n/, 1)[0] : undefined,
    };
  });
  const runs = new Map<
    string,
    {
      run: string;
      loop: string;
      sha: string;
      kind: string;
      branch?: string;
      shortstat?: string;
      text?: string;
    }
  >();
  for (const row of rows(database).filter((row) => row.loop && runKinds.has(row.kind))) {
    const run = `${row.loop}@${row.sha}`;
    const payload = JSON.parse(row.payload) as Record<string, string>;
    const current = runs.get(run) ?? { run, loop: row.loop!, sha: row.sha, kind: row.kind };
    runs.set(run, {
      ...current,
      kind: row.kind,
      ...(payload.branch ? { branch: payload.branch } : {}),
      ...(payload.shortstat ? { shortstat: payload.shortstat } : {}),
      ...(row.kind === "verdict" ? { text: payload.text } : {}),
    });
  }
  return {
    tip: git(repo, "rev-parse", config.factory.ref),
    readings,
    loops,
    runs: [...runs.values()],
    setpoints: Object.assign({}, ...Object.values(config.loop).map((loop) => loop.setpoint ?? {})),
  };
};

const sendJson = (response: ServerResponse, value: unknown, status = 200) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const runDetail = (database: DatabaseSync, run: string) => {
  const at = run.lastIndexOf("@");
  if (at < 1) return;
  const loop = run.slice(0, at);
  const sha = run.slice(at + 1);
  const events = database
    .prepare("SELECT * FROM events WHERE loop = ? AND sha = ? ORDER BY seq")
    .all(loop, sha) as EventRow[];
  if (!events.length) return;
  const details: Record<string, unknown> = { run, loop, sha, events, verdicts: [] };
  for (const event of events) {
    const data = JSON.parse(event.payload) as Record<string, unknown>;
    if (event.kind === "error") details.error = data.values;
    for (const key of ["branch", "worktree", "head", "shortstat", "stdout", "stderr"]) {
      if (data[key] !== undefined) details[key] = data[key];
    }
    if (event.kind === "verdict") {
      (details.verdicts as object[]).push({ seq: event.seq, ts: event.ts, ...data });
    }
  }
  return details;
};

const sendText = (response: ServerResponse, value: string, status = 200) => {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(value);
};

export const serve = (repo: string, database: DatabaseSync) =>
  createServer((request, response) => {
    const config = configAt(repo);
    const url = new URL(request.url ?? "/", "http://localhost");
    const since = Math.max(0, Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0);
    const runRoute = url.pathname.match(/^\/runs\/([^/]+)(?:\/(diff|open))?$/);
    let run: string | undefined;
    try {
      run = runRoute ? decodeURIComponent(runRoute[1]!) : undefined;
    } catch {
      sendText(response, "malformed run", 400);
      return;
    }
    const detail = run ? runDetail(database, run) : undefined;
    if (request.method === "POST" && runRoute?.[2] === "open") {
      const worktree = detail?.worktree as string | undefined;
      if (!worktree) sendText(response, "run has no worktree", 404);
      else {
        const finder = process.platform === "win32" ? "where.exe" : "which";
        if (spawnSync(finder, ["code"], { stdio: "ignore" }).status !== 0) {
          sendText(response, worktree, 501);
        } else {
          const child = spawn("code", [worktree], {
            detached: true,
            shell: process.platform === "win32",
            stdio: "ignore",
          });
          child.once("error", () => {
            if (!response.writableEnded) sendText(response, worktree, 501);
          });
          child.once("spawn", () => sendText(response, worktree));
          child.unref();
        }
      }
    } else if (request.method === "POST" && url.pathname === "/verdict") {
      let body = "";
      let tooLarge = false;
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        if (!tooLarge) body += chunk;
        if (body.length > 65_536) tooLarge = true;
      });
      request.on("end", () => {
        if (tooLarge) {
          sendJson(response, { error: "verdict body is too large" }, 413);
          return;
        }
        try {
          sendJson(
            response,
            recordVerdict(database, JSON.parse(body) as Parameters<typeof recordVerdict>[1]),
          );
        } catch (error) {
          sendJson(
            response,
            { error: error instanceof Error ? error.message : String(error) },
            400,
          );
        }
      });
    } else if (request.method !== "GET") {
      response.writeHead(405).end();
    } else if (runRoute?.[2] === "diff") {
      const sha = detail?.sha as string | undefined;
      const head = detail?.head as string | undefined;
      if (!sha || !head) sendText(response, "run has no proposal", 404);
      else
        sendText(
          response,
          execFileSync("git", ["-C", repo, "diff", `${sha}..${head}`], { encoding: "utf8" }),
        );
    } else if (runRoute) {
      if (detail) sendJson(response, detail);
      else sendJson(response, { error: "run not found" }, 404);
    } else if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(readFileSync(new URL("./ui/index.html", import.meta.url), "utf8"));
    } else if (url.pathname === "/events.json") {
      sendJson(response, rows(database, since));
    } else if (url.pathname === "/declaration") {
      sendJson(response, config);
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

async function main() {
  const args = process.argv.slice(2);
  const repoIndex = args.indexOf("--repo");
  if (repoIndex >= 0 && !args[repoIndex + 1]) throw new Error("--repo requires a path");
  const repo = resolve(repoIndex >= 0 ? args[repoIndex + 1]! : process.cwd());
  const config = configAt(repo);
  const command =
    repoIndex >= 0
      ? args.filter((_, index) => index !== repoIndex && index !== repoIndex + 1)
      : args;
  const backfillIndex = args.indexOf("--backfill");
  if (backfillIndex >= 0) {
    const count = Number.parseInt(args[backfillIndex + 1] ?? "", 10);
    if (!Number.isInteger(count) || count < 1)
      throw new Error("--backfill requires a positive count");
    backfill(repo, count);
    return;
  }
  if (args.includes("--once")) {
    tick(repo);
    return;
  }
  const [verb, target, decision, ...text] = command;
  if (verb === "sense") {
    const database = openDatabase(repo, config);
    try {
      const sha = git(repo, "rev-parse", target ?? config.factory.ref);
      const parent = git(repo, "rev-list", "--parents", "-n", "1", sha).split(" ")[1];
      sense(repo, config, database, sha, parent, true);
      console.log(
        JSON.stringify(
          rows(database)
            .filter((row) => row.kind === "reading" && row.sha === sha)
            .map((row) => ({ sha: row.sha, ...JSON.parse(row.payload) })),
          null,
          2,
        ),
      );
    } finally {
      database.close();
    }
    return;
  }
  if (verb === "run") {
    const loop = target && config.loop[target];
    if (!target || !loop) throw new Error(`unknown loop: ${target ?? ""}`);
    const database = openDatabase(repo, config);
    try {
      act(repo, config, database, target, loop, git(repo, "rev-parse", config.factory.ref), true);
    } finally {
      database.close();
    }
    return;
  }
  if (verb === "pause" || verb === "resume") {
    if (!target) throw new Error(`${verb} requires a loop`);
    setLoopPaused(repo, target, verb === "pause");
    return;
  }
  if (verb === "verdict") {
    if (!target || !["accept", "reject"].includes(decision ?? "")) {
      throw new Error("verdict requires <run> accept|reject [text]");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${config.factory.port}/verdict`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run: target, decision, text: text.join(" ") }),
      });
      console.log(await response.text());
      if (!response.ok) process.exitCode = 1;
    } catch {
      console.error("factory daemon is not running");
      process.exitCode = 1;
    }
    return;
  }
  if (verb) throw new Error(`unknown verb: ${verb}`);

  const database = openDatabase(repo, config);
  tick(repo, database);
  const server = serve(repo, database);
  const host = config.factory.host ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) throw new Error(`invalid factory host: ${host}`);
  server.listen(config.factory.port, host, () =>
    console.log(`factory listening on http://${host}:${config.factory.port}`),
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

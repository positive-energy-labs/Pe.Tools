import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vite-plus/test";

import { recordVerdict, tick } from "../src/main.ts";

describe("tick", () => {
  it("triggers, senses, gates, reruns, and merges", () => {
    const repo = mkdtempSync(join(tmpdir(), "pe factory-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
    try {
      git("init", "-b", "main");
      git("config", "user.email", "factory@test.invalid");
      git("config", "user.name", "Factory Test");
      writeFileSync(
        join(repo, "sensor.mjs"),
        'import {existsSync,readdirSync} from "node:fs"; import {dirname,join} from "node:path"; import {fileURLToPath} from "node:url"; if(process.env.FACTORY_ROOT!==dirname(fileURLToPath(import.meta.url))) throw new Error("wrong FACTORY_ROOT"); if(existsSync(join(process.env.FACTORY_ROOT,"fail.flag"))) throw new Error("boom"); console.log(JSON.stringify({n:readdirSync(".").filter(x=>x.endsWith(".txt")).length}))\n',
      );
      writeFileSync(
        join(repo, "factory.toml"),
        '[factory]\nref="main"\npoll_seconds=1\nport=4747\ndb=".artifacts/events.sqlite"\n[sensor.files]\nrun="node {root}/sensor.mjs"\nscope=["**/*.txt","*.txt"]\n[loop.watch]\nsense=["files"]\nsetpoint={"files.n"="down"}\n',
      );
      writeFileSync(join(repo, "one.txt"), "one\n");
      git("add", "factory.toml", "sensor.mjs", "one.txt");
      git("commit", "-m", "one");

      tick(repo);
      tick(repo);

      writeFileSync(join(repo, "two.txt"), "two\n");
      git("add", "two.txt");
      git("commit", "-m", "two");
      tick(repo);

      const database = new DatabaseSync(join(repo, ".artifacts", "events.sqlite"));
      expect(
        database
          .prepare("SELECT kind, count(*) count FROM events GROUP BY kind ORDER BY kind")
          .all(),
      ).toEqual([
        { kind: "error", count: 2 },
        { kind: "reading", count: 2 },
        { kind: "triggered", count: 2 },
      ]);
      const error = database
        .prepare("SELECT payload FROM events WHERE kind = 'error' ORDER BY seq DESC LIMIT 1")
        .get() as { payload: string };
      expect(JSON.parse(error.payload)).toEqual({ loop: "watch", values: { "files.n": 1 } });

      writeFileSync(join(repo, "notes.md"), "scope skip\n");
      git("add", "notes.md");
      git("commit", "-m", "skip");
      tick(repo);
      expect(
        database.prepare("SELECT count(*) count FROM events WHERE kind = 'reading'").get(),
      ).toEqual({ count: 2 });

      writeFileSync(join(repo, "three.txt"), "three\n");
      writeFileSync(join(repo, "fail.flag"), "fail\n");
      git("add", "three.txt");
      git("commit", "-m", "fail");
      tick(repo);
      const failedError = database
        .prepare("SELECT payload FROM events WHERE kind = 'error' ORDER BY seq DESC LIMIT 1")
        .get() as { payload: string };
      expect(JSON.parse(failedError.payload)).toEqual({
        loop: "watch",
        values: { "files.n": null },
      });

      rmSync(join(repo, "fail.flag"));
      tick(repo);
      expect(
        database.prepare("SELECT count(*) count FROM events WHERE kind = 'reading'").get(),
      ).toEqual({
        count: 3,
      });
      const sha = git("rev-parse", "HEAD").toString().trim();
      expect(existsSync(join(repo, ".artifacts", "factory", "checkouts", sha.slice(0, 7)))).toBe(
        false,
      );

      writeFileSync(
        join(repo, "actuator.mjs"),
        'import {appendFileSync} from "node:fs"; const auto=process.env.FACTORY_LOOP==="auto"; appendFileSync(auto?"one.txt":"feedback.txt",auto?"x":process.env.FACTORY_FEEDBACK||"first");\n',
      );
      writeFileSync(
        join(repo, "factory.toml"),
        '[factory]\nref="main"\npoll_seconds=1\nport=4747\ndb=".artifacts/events.sqlite"\n[actuator.change]\nrun="node {root}/actuator.mjs"\n[loop.auto]\nact="change"\ngate="auto"\n',
      );
      git("add", "actuator.mjs", "factory.toml");
      git("commit", "-m", "auto loop");
      const autoSha = git("rev-parse", "HEAD").toString().trim();
      tick(repo, database);
      expect(
        database
          .prepare(
            "SELECT kind FROM events WHERE loop = 'auto' AND sha = ? AND kind IN ('acting','proposed','merged') ORDER BY seq",
          )
          .all(autoSha),
      ).toEqual([{ kind: "acting" }, { kind: "proposed" }, { kind: "merged" }]);
      expect(
        git("rev-list", "--parents", "-n", "1", "main").toString().trim().split(" "),
      ).toHaveLength(3);

      writeFileSync(
        join(repo, "factory.toml"),
        '[factory]\nref="main"\npoll_seconds=1\nport=4747\ndb=".artifacts/events.sqlite"\n[actuator.change]\nrun="node {root}/actuator.mjs"\n[loop.human]\nact="change"\ngate="human"\n',
      );
      git("add", "factory.toml");
      git("commit", "-m", "human loop");
      const humanSha = git("rev-parse", "HEAD").toString().trim();
      const run = `human@${humanSha}`;
      tick(repo, database);
      recordVerdict(database, { run, decision: "reject", text: "say hello instead" });
      tick(repo, database);
      expect(
        database
          .prepare(
            "SELECT count(*) count FROM events WHERE loop = 'human' AND sha = ? AND kind = 'acting'",
          )
          .get(humanSha),
      ).toEqual({ count: 2 });
      expect(
        readFileSync(
          join(
            repo,
            ".artifacts",
            "factory",
            "runs",
            `human-${humanSha.slice(0, 7)}`,
            "feedback.txt",
          ),
          "utf8",
        ),
      ).toBe("say hello instead");
      recordVerdict(database, { run, decision: "accept", text: "accepted" });
      tick(repo, database);
      expect(
        database
          .prepare(
            "SELECT kind FROM events WHERE loop = 'human' AND sha = ? ORDER BY seq DESC LIMIT 1",
          )
          .get(humanSha),
      ).toEqual({ kind: "merged" });
      expect(
        git("rev-list", "--parents", "-n", "1", "main").toString().trim().split(" "),
      ).toHaveLength(3);
      database.close();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);
});

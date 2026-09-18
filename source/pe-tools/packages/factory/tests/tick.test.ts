import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vite-plus/test";

import { tick } from "../src/main.ts";

describe("tick", () => {
  it("triggers and reads once per sha, then reports a rising down error", () => {
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
      database.close();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

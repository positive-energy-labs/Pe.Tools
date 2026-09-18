import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vite-plus/test";

import { tick } from "../src/main.ts";

describe("tick", () => {
  it("triggers and reads once per sha, then reports a rising down error", () => {
    const repo = mkdtempSync(join(tmpdir(), "pe-factory-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
    try {
      git("init", "-b", "main");
      git("config", "user.email", "factory@test.invalid");
      git("config", "user.name", "Factory Test");
      writeFileSync(
        join(repo, "sensor.mjs"),
        'import {readdirSync} from "node:fs"; console.log(JSON.stringify({n:readdirSync(".").filter(x=>x.endsWith(".txt")).length}))\n',
      );
      writeFileSync(
        join(repo, "factory.toml"),
        '[factory]\nref="main"\npoll_seconds=1\nport=4747\ndb=".artifacts/events.sqlite"\n[sensor.files]\nrun="node sensor.mjs"\nscope=["**/*.txt","*.txt"]\n[loop.watch]\nsense=["files"]\nsetpoint={"files.n"="down"}\n',
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
      database.close();
      expect(readFileSync(join(repo, "factory.toml"), "utf8")).toContain('ref="main"');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

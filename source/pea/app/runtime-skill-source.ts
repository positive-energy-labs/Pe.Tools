import type { SkillSource, SkillSourceEntry, SkillSourceStat } from "@mastra/core/workspace";
import { LocalSkillSource } from "@mastra/core/workspace";
import type { RuntimeSkillDefinition } from "./runtime-skill-files.js";

export interface MemorySkillMount {
  root: string;
  skills: readonly RuntimeSkillDefinition[];
}

export function createRuntimeSkillSource(options: {
  cwd: string;
  memoryMounts: readonly MemorySkillMount[];
}): SkillSource {
  return new RuntimeSkillSource({
    fallback: new LocalSkillSource({ basePath: options.cwd }),
    memoryMounts: options.memoryMounts,
  });
}

class RuntimeSkillSource implements SkillSource {
  readonly #fallback: SkillSource;
  readonly #mounts: Map<string, MemorySkillMountSource>;

  constructor(options: { fallback: SkillSource; memoryMounts: readonly MemorySkillMount[] }) {
    this.#fallback = options.fallback;
    this.#mounts = new Map(
      options.memoryMounts.map((mount) => [
        normalizePath(mount.root),
        new MemorySkillMountSource(mount.root, mount.skills),
      ]),
    );
  }

  async exists(skillPath: string): Promise<boolean> {
    const route = this.#route(skillPath);
    return route ? route.source.exists(route.subPath) : this.#fallback.exists(skillPath);
  }

  async stat(skillPath: string): Promise<SkillSourceStat> {
    const route = this.#route(skillPath);
    return route ? route.source.stat(route.subPath) : this.#fallback.stat(skillPath);
  }

  async readFile(skillPath: string): Promise<string | Buffer> {
    const route = this.#route(skillPath);
    return route ? route.source.readFile(route.subPath) : this.#fallback.readFile(skillPath);
  }

  async readdir(skillPath: string): Promise<SkillSourceEntry[]> {
    const route = this.#route(skillPath);
    return route ? route.source.readdir(route.subPath) : this.#fallback.readdir(skillPath);
  }

  async realpath(skillPath: string): Promise<string> {
    const route = this.#route(skillPath);
    if (route) return `${route.mountRoot}/${await route.source.realpath(route.subPath)}`;
    return this.#fallback.realpath?.(skillPath) ?? skillPath;
  }

  #route(
    skillPath: string,
  ): { mountRoot: string; source: MemorySkillMountSource; subPath: string } | undefined {
    const normalized = normalizePath(skillPath);
    for (const [mountRoot, source] of this.#mounts) {
      if (normalized === mountRoot) {
        return { mountRoot, source, subPath: "" };
      }
      if (normalized.startsWith(`${mountRoot}/`)) {
        return {
          mountRoot,
          source,
          subPath: normalized.slice(mountRoot.length + 1),
        };
      }
    }
    return undefined;
  }
}

class MemorySkillMountSource implements SkillSource {
  readonly #root: string;
  readonly #createdAt = new Date(0);
  readonly #skills: Map<string, string>;

  constructor(root: string, skills: readonly RuntimeSkillDefinition[]) {
    this.#root = normalizePath(root);
    this.#skills = new Map(skills.map((skill) => [skill.name, `${skill.content.trimEnd()}\n`]));
  }

  async exists(skillPath: string): Promise<boolean> {
    const normalized = normalizePath(skillPath);
    if (!normalized) return true;

    const parsed = parseMemorySkillPath(normalized);
    if (!parsed) return false;
    if (!this.#skills.has(parsed.skillName)) return false;
    return parsed.filePath == null || parsed.filePath === "SKILL.md";
  }

  async stat(skillPath: string): Promise<SkillSourceStat> {
    const normalized = normalizePath(skillPath);
    if (!normalized) return this.#stat(".", "directory", 0);

    const parsed = parseMemorySkillPath(normalized);
    if (!parsed || !this.#skills.has(parsed.skillName)) {
      throw new Error(`Skill path not found: ${this.#root}/${normalized}`);
    }
    if (parsed.filePath == null) return this.#stat(parsed.skillName, "directory", 0);
    if (parsed.filePath === "SKILL.md") {
      return this.#stat("SKILL.md", "file", this.#skills.get(parsed.skillName)!.length);
    }
    throw new Error(`Skill path not found: ${this.#root}/${normalized}`);
  }

  async readFile(skillPath: string): Promise<string | Buffer> {
    const normalized = normalizePath(skillPath);
    const parsed = parseMemorySkillPath(normalized);
    if (parsed?.filePath === "SKILL.md") {
      const content = this.#skills.get(parsed.skillName);
      if (content != null) return content;
    }
    throw new Error(`Skill file not found: ${this.#root}/${normalized}`);
  }

  async readdir(skillPath: string): Promise<SkillSourceEntry[]> {
    const normalized = normalizePath(skillPath);
    if (!normalized) {
      return [...this.#skills.keys()].map((name) => ({ name, type: "directory" }));
    }

    const parsed = parseMemorySkillPath(normalized);
    if (parsed?.filePath == null && this.#skills.has(parsed?.skillName ?? "")) {
      return [{ name: "SKILL.md", type: "file" }];
    }
    throw new Error(`Skill directory not found: ${this.#root}/${normalized}`);
  }

  async realpath(skillPath: string): Promise<string> {
    return normalizePath(skillPath);
  }

  #stat(name: string, type: "file" | "directory", size: number): SkillSourceStat {
    return {
      name,
      type,
      size,
      createdAt: this.#createdAt,
      modifiedAt: this.#createdAt,
      ...(type === "file" ? { mimeType: "text/markdown" } : {}),
    };
  }
}

function parseMemorySkillPath(
  skillPath: string,
): { skillName: string; filePath?: string } | undefined {
  const segments = skillPath.split("/");
  const skillName = segments[0];
  if (!skillName) return undefined;
  if (segments.length === 1) return { skillName };
  return { skillName, filePath: segments.slice(1).join("/") };
}

function normalizePath(skillPath: string): string {
  return skillPath
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

import { appendFileSync, mkdirSync } from "node:fs";

const feedback = process.env.FACTORY_FEEDBACK?.trim() || "echo";
mkdirSync("docs/features/factory", { recursive: true });
appendFileSync("docs/features/factory/ECHO.md", `- ${feedback}\n`);

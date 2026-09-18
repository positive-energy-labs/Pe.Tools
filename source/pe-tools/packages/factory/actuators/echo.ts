import { appendFileSync } from "node:fs";

const feedback = process.env.FACTORY_FEEDBACK?.trim() || "echo";
appendFileSync("docs/features/factory/ECHO.md", `- ${feedback}\n`);

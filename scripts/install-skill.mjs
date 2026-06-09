import { cpSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "skill");
const destinations = [
  join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills", "codex-kimi"),
  join(process.env.AGENTS_HOME || join(homedir(), ".agents"), "skills", "codex-kimi"),
];

for (const dest of destinations) {
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(source, dest, { recursive: true });
  console.log(`installed skill: ${dest}`);
}

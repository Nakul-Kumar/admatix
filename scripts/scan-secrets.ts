import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const excludedDirs = new Set([".git", ".turbo", "coverage", "dist", "node_modules"]);
const excludedFiles = new Set(["pnpm-lock.yaml"]);
const textExtensions = new Set([
  ".css",
  ".env",
  ".example",
  ".html",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const patterns: Array<{ name: string; regex: RegExp }> = [
  { name: "OpenAI-style API key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Google API key", regex: /\bAIza[A-Za-z0-9_-]{20,}\b/g },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: "assigned secret-like value",
    regex: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/gi,
  },
];

function extensionOf(path: string): string {
  const match = path.match(/(\.[^.\\/]*)$/);
  return match?.[1] ?? "";
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return excludedDirs.has(entry) ? [] : listFiles(path);
    if (excludedFiles.has(entry)) return [];
    return textExtensions.has(extensionOf(entry)) ? [path] : [];
  });
}

const findings: string[] = [];

for (const path of listFiles(root)) {
  const text = readFileSync(path, "utf8");
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const prefix = text.slice(0, match.index ?? 0);
      const line = prefix.split(/\r?\n/).length;
      findings.push(`${relative(root, path)}:${line} ${pattern.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("scan-secrets: potential secret(s) found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("scan-secrets: no token-shaped secrets found.");

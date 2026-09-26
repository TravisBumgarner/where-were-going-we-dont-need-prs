// Launching Claude Code: interactively for `wit chat`, headless for `wit condense` / `wit apply`.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PACKAGE_ROOT } from "./config.ts";
import { witDir } from "./workdir.ts";

export const prompt = (name: string, vars: Record<string, string>) =>
  readFileSync(join(PACKAGE_ROOT, "src", "prompts", `${name}.md`), "utf8").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");

export const runInteractive = (cwd: string, args: string[]) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn("claude", args, { cwd, stdio: "inherit" });
    child.on("error", (err) => reject(new Error(`Couldn't start claude: ${err.message}. Is Claude Code installed?`)));
    child.on("exit", (code) => resolve(code ?? 0));
  });

const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

// Runs Claude headless, printing a line per tool call as progress. Returns the final message.
export const runHeadless = (cwd: string, text: string, allowedTools: string[]) =>
  new Promise<string>((resolve, reject) => {
    const args = ["-p", text, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowedTools", ...allowedTools];
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let buffer = "";
    let result: { result?: string; is_error?: boolean } | null = null;
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "assistant") {
          for (const block of event.message?.content ?? []) {
            if (block.type !== "tool_use") continue;
            const target = block.input?.file_path ?? block.input?.path ?? block.input?.pattern ?? block.input?.command ?? "";
            console.log(dim(`  ${block.name} ${String(target).replace(cwd + "/", "")}`.slice(0, 120)));
          }
        } else if (event.type === "result") {
          result = event;
        }
      }
    });
    child.on("error", (err) => reject(new Error(`Couldn't start claude: ${err.message}. Is Claude Code installed?`)));
    child.on("exit", (code) => {
      if (!result || result.is_error || code !== 0) reject(new Error(`Claude didn't finish cleanly (exit ${code}). ${result?.result ?? ""}`));
      else resolve(result.result ?? "");
    });
  });

// The last ```json block in Claude's final message.
export const reportFrom = <T>(message: string): T => {
  const blocks = [...message.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) throw new Error(`Claude didn't return a report. Its final message was:\n${message}`);
  return JSON.parse(blocks.at(-1)![1]);
};

// Claude Code stores each session as JSONL under ~/.claude/projects/<escaped cwd>/<id>.jsonl.
const findTranscript = (sessionId: string) => {
  const projects = join(homedir(), ".claude", "projects");
  if (!existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) {
    const file = join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) return file;
  }
  return null;
};

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "tool_use") {
        const target = block.input?.file_path ?? block.input?.command ?? "";
        return `[${block.name}${target ? ` ${String(target).slice(0, 200)}` : ""}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

// Converts a session transcript to a readable markdown file, keeping only what was said.
export const writeTranscript = (root: string, sessionId: string) => {
  const source = findTranscript(sessionId);
  if (!source) return null;
  const out: string[] = [];
  for (const line of readFileSync(source, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.isMeta || (event.type !== "user" && event.type !== "assistant")) continue;
    const text = textOf(event.message?.content)
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
      .replace(/<local-command-[\w-]+>[\s\S]*?<\/local-command-[\w-]+>/g, "")
      .trim();
    if (text) out.push(`### ${event.type === "user" ? "User" : "Claude"}\n\n${text}\n`);
  }
  const dir = join(witDir(root), "transcripts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.md`);
  writeFileSync(file, out.join("\n"));
  return file;
};

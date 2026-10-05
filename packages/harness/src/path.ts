// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";

const run = promisify(execFile);

/**
 * A desktop app launched from Finder does not inherit the shell PATH, so `claude`
 * and `codex` installed via nvm or Homebrew are invisible. Ask the login shell
 * once and merge its PATH into ours. Idea borrowed from T3 Code's os-jank.ts.
 */
export async function hydratePathFromLoginShell(): Promise<string> {
  if (process.platform === "win32") {
    let registered = "";
    try {
      registered = (await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetEnvironmentVariable('Path','Machine'); [Environment]::GetEnvironmentVariable('Path','User')"], { timeout: 4000, windowsHide: true })).stdout;
    } catch { /* Keep inherited PATH if registry lookup is unavailable. */ }
    const paths = [...(process.env["PATH"] ?? "").split(";"), ...registered.split(/[;\r\n]/), join(homedir(), ".local", "bin"), ...(process.env["APPDATA"] ? [join(process.env["APPDATA"], "npm")] : []), ...(process.env["LOCALAPPDATA"] ? [join(process.env["LOCALAPPDATA"], "Programs", "nodejs"), join(process.env["LOCALAPPDATA"], "Volta", "bin"), join(process.env["LOCALAPPDATA"], "pnpm")] : [])];
    const seen = new Set<string>();
    process.env["PATH"] = paths.map(p => p.trim()).filter(p => {
      if (!p || seen.has(p.toLowerCase())) return false;
      seen.add(p.toLowerCase()); return true;
    }).join(";");
    return process.env["PATH"];
  }
  const shell = process.env["SHELL"] || "/bin/zsh";
  try {
    const { stdout } = await run(shell, ["-ilc", "printf '%s' \"$PATH\""], { timeout: 4000 });
    const found = stdout.trim();
    if (found) {
      const merged = Array.from(new Set([...found.split(":"), ...(process.env["PATH"] ?? "").split(":")])).filter(Boolean);
      process.env["PATH"] = merged.join(":");
    }
  } catch {
    // keep whatever PATH we had
  }
  return process.env["PATH"] ?? "";
}

export async function which(bin: string): Promise<string | null> {
  try {
    // Windows runners can have long PATHs and cold executable scans. Keep discovery
    // bounded without treating a slow lookup as a missing provider after two seconds.
    const { stdout } = await run(process.platform === "win32" ? "where.exe" : "which", [bin], { timeout: process.platform === "win32" ? 10_000 : 2000, windowsHide: true });
    const candidates = stdout.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
    if (process.platform !== "win32") return candidates[0] ?? null;
    for (const candidate of candidates) {
      if (/\.(exe|com)$/i.test(candidate)) return candidate;
      if (/\.cmd$/i.test(candidate)) {
        if (bin === "claude") {
          const native = join(dirname(candidate), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
          try { await access(native); return native; } catch { /* Older packages use a JS entry. */ }
        }
        // npm shims cannot be spawned directly, and an extensionless sibling is a Unix shell script.
        // Resolve the shim's JS entry point, never execute its text through a command shell.
        try {
          const entry = (await readFile(candidate, "utf8")).match(/"%dp0%[\\/]([^"\r\n]+\.(?:[cm]?js|exe))"/i)?.[1];
          if (entry) {
            const script = resolve(dirname(candidate), entry);
            await access(script);
            return script;
          }
        } catch { /* Try the next PATH entry if this shim is broken. */ }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function cliInvocation(bin: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return process.platform === "win32" && /\.[cm]?js$/i.test(bin)
    ? { bin: process.execPath, args: [bin, ...args], env: { ...env, ELECTRON_RUN_AS_NODE: "1" } }
    : { bin, args, env };
}

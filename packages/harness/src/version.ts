// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cliInvocation } from "./path.ts";
const run = promisify(execFile);

export async function cliVersion(bin: string, args: string[] = ["--version"], timeout = 5000): Promise<string | null> {
  try {
    const command = cliInvocation(bin, args);
    const { stdout, stderr } = await run(command.bin, command.args, { timeout, env: command.env, windowsHide: true });
    const m = `${stdout}\n${stderr}`.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms))]);

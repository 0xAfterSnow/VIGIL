// Runs a workspace member's package.json script with the package manager that is running the
// current script, so the SDK works the same under bun, npm, pnpm and yarn.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCKFILES: ReadonlyArray<readonly [lockfile: string, packageManager: string]> = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

export function packageManager(from: string = process.cwd()): string {
  const agent = process.env.npm_config_user_agent?.split('/')[0];
  if (agent && agent !== 'node') return agent;
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const match = LOCKFILES.find(([lockfile]) => existsSync(join(dir, lockfile)));
    if (match) return match[1];
    if (dirname(dir) === dir) return 'npm';
  }
}

export function runIn(dir: string, script: string, args: string[] = []): Promise<number> {
  const child = spawn(packageManager(dir), ['run', script, ...args], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return new Promise(resolveExit => child.on('exit', code => resolveExit(code ?? 1)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, script, ...args] = process.argv.slice(2);
  if (!dir || !script) {
    console.error('usage: tsx scripts/run-in.ts <dir> <script> [args…]');
    process.exit(2);
  }
  process.exit(await runIn(resolve(dir), script, args));
}

// Mirrors simulator/local-node/game-contracts.ts compile settings + the watcher's game detection.
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import solc from 'solc';

const dir = resolve(import.meta.dirname, 'simulator/contracts');
const file = process.argv[2] ?? 'VigilGame.sol';
const source = readFileSync(resolve(dir, file), 'utf8');

const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: 'Solidity',
      sources: { [file]: { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      },
    }),
    {
      import: (p: string) => {
        const sibling = resolve(dir, p);
        if (sibling.startsWith(dir)) return { contents: readFileSync(sibling, 'utf8') };
        if (basename(p) === 'ICasinoGameV2.sol') {
          return { contents: readFileSync(resolve(dir, 'ICasinoGameV2.sol'), 'utf8') };
        }
        return { error: `Import not found: ${p}` };
      },
    },
  ),
) as {
  errors?: Array<{ severity: string; formattedMessage: string }>;
  contracts?: Record<string, Record<string, { abi: Array<{ type: string; name?: string }>; evm: { bytecode: { object: string } } }>>;
};

for (const e of output.errors ?? []) {
  console.log(`[${e.severity}] ${e.formattedMessage.split('\n')[0]}`);
}
const errors = (output.errors ?? []).filter(e => e.severity === 'error');
if (errors.length > 0) {
  console.log('COMPILE FAILED');
  process.exit(1);
}
for (const [name, c] of Object.entries(output.contracts?.[file] ?? {})) {
  const fns = c.abi.filter(a => a.type === 'function').map(a => a.name!);
  const isGame = ['quoteCaps', 'onPlayerAction'].every(n => fns.includes(n));
  console.log(
    `COMPILED ${name}  bytecode=${c.evm.bytecode.object.length / 2} bytes  watcherDetectsGame=${isGame}`,
  );
  console.log(`  functions: ${fns.sort().join(', ')}`);
}

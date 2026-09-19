/**
 * Pulls ground truth straight from the deployed VigilGame and writes `src/game/golden.json`:
 * `words[]` with the exact on-chain `deriveOrder`, and `payouts[]` with the exact on-chain
 * `payoutFor` for all 12 tickets at several wagers. `parity.test.ts` pins the client's TS mirror
 * to this file, so a drift between the client and the contract can never ship silently.
 *
 * Usage: npx tsx test/generate-golden.ts [--count 200]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, http, pad, toBytes, toHex } from 'viem';
import { foundry } from 'viem/chains';

const NODE = process.env.VIGIL_RPC ?? 'http://127.0.0.1:8545';
const COUNT = Number(process.argv[2]?.split('=')[1] ?? process.argv[3] ?? 200);

type DeployRecord = {
  games: { name: string; address: string }[];
};

const rec: DeployRecord = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../simulator/local-node/deployed.json'), 'utf8'),
);

const byName = (name: string) => {
  const hit = rec.games.find(g => g.name === name);
  if (!hit) throw new Error(`no ${name} in deployed.json`);
  return hit.address as `0x${string}`;
};

const pub = createPublicClient({ chain: foundry, transport: http(NODE) });
const game = byName('VigilGame');

const abi = [
  {
    type: 'function',
    name: 'deriveOrder',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'uint256[6]', internalType: 'uint256[6]' }],
  },
  {
    type: 'function',
    name: 'payoutFor',
    stateMutability: 'pure',
    inputs: [
      { type: 'uint256' },
      { type: 'uint8' },
      { type: 'uint8' },
      { type: 'bool' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxMultiplierBps',
    stateMutability: 'pure',
    inputs: [{ type: 'uint8' }, { type: 'uint8' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const words: string[] = [];
const orders: number[][] = [];
const payouts: { wager: string; candle: number; ticket: number; win: boolean; payout: string }[] = [];
const multipliers: { candle: number; ticket: number; bps: string }[] = [];

const WAGERS = [10n ** 15n, 10n ** 16n, 5n * 10n ** 17n];

for (let i = 0; i < COUNT; i++) {
  const seed = pad(toHex(BigInt(i) * 0x9e3779b97f4a7c15n, { size: 32 }), { size: 32 });
  // a healthy spread of words, not just a counter
  const word = toHex(toBytes(seed).map(b => (b * 31 + i * 7 + 13) & 0xff), { size: 32 });
  const order = await pub.readContract({ address: game, abi, functionName: 'deriveOrder', args: [word] });
  words.push(word);
  orders.push(order.map(Number));
}

for (let candle = 0; candle < 6; candle++) {
  for (const ticket of [0, 1] as const) {
    for (const win of [true, false]) {
      for (const wager of WAGERS) {
        const payout = await pub.readContract({
          address: game,
          abi,
          functionName: 'payoutFor',
          args: [wager, BigInt(candle), ticket, win],
        });
        payouts.push({ wager: wager.toString(), candle, ticket, win, payout: payout.toString() });
      }
    }
    const bps = await pub.readContract({ address: game, abi, functionName: 'maxMultiplierBps', args: [candle, ticket] });
    multipliers.push({ candle, ticket, bps: bps.toString() });
  }
}

const out = { generatedFrom: game, words, orders, payouts, multipliers };
const target = resolve(import.meta.dirname, '../src/game/golden.json');
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `golden.json written: ${words.length} words, ${payouts.length} payouts, ${multipliers.length} multipliers (from ${game})`,
);

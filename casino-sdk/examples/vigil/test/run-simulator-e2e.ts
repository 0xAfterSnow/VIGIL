#!/usr/bin/env tsx
/**
 * PRD §9 test 8 (chain half) — end-to-end through the SDK's local casino host.
 *
 *   cd casino-sdk && npm start                   # chain + real Verify Network VRF node + host
 *   npx tsx examples/vigil/test/run-simulator-e2e.ts
 *
 * Places one real bet for every one of the 12 tickets via `LocalCasinoHost.openSession`, lets the
 * real VRF node fulfil each request, then decodes the settled `gameState` from the
 * `CasinoSessionSettled` event and checks it against what the contract must have decided. This is
 * the same chain the harness iframe drives, so a pass here means the session lifecycle (escrow,
 * reserve, zero-slack payout cap, settlement) is correct before any UI exists.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const deployedFile = resolve(import.meta.dirname, '../../../simulator/local-node/deployed.json');
const deployment = JSON.parse(readFileSync(deployedFile, 'utf8')) as {
  chainId: number;
  rpcUrl: string;
  host: Address;
  token: Address;
  vault: Address;
  games: Array<{ name: string; address: Address }>;
};
const gameAddress = deployment.games.find(g => g.name === 'VigilGame')?.address;
if (!gameAddress) throw new Error('VigilGame is not in deployed.json — is the local node running?');

const chain = {
  id: deployment.chainId,
  name: 'casino-sdk simulator',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpcUrl] } },
} as const;
const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const pub = createPublicClient({ chain, transport: http(deployment.rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(deployment.rpcUrl), account });

const erc20 = parseAbi(['function approve(address,uint256) returns (bool)']);
const hostAbi = parseAbi([
  'function openSession(address game, address vault, uint256 wager, bytes gameData) returns (uint256 sessionId, bytes32 requestId)',
  'function currentSessionId() view returns (uint256)',
  'event CasinoSessionSettled(uint256 indexed sessionId, address indexed game, address indexed player, uint8 phase, uint256 payout, bytes32 randomness, bytes gameState)',
]);
const gameAbi = parseAbi([
  'function payoutFor(uint256 wager, uint8 candle, uint8 ticket, bool won) view returns (uint256)',
  'function deriveOrder(bytes32 randomness) view returns (uint8[6])',
  'function quoteCaps(uint256 wager, bytes gameData) view returns (uint256,uint256)',
]);

const WAGER = parseEther('5');
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures += 1;
    console.log(`  FAIL ${what}`);
  }
};

await pub.waitForTransactionReceipt({
  hash: await wallet.writeContract({
    address: deployment.token,
    abi: erc20,
    functionName: 'approve',
    args: [deployment.host, WAGER * 12n],
  }),
});

const rows: string[] = [];
const seenOrders = new Set<string>();

for (let ticket = 0; ticket < 2; ticket++) {
  for (let candle = 0; candle < 6; candle++) {
    const gameData = encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'uint8' }],
      [candle, ticket],
    ) as Hex;
    const caps = await pub.readContract({
      address: gameAddress,
      abi: gameAbi,
      functionName: 'quoteCaps',
      args: [WAGER, gameData],
    });
    const maxReservedProfit = caps[1];

    await pub.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: deployment.host,
        abi: hostAbi,
        functionName: 'openSession',
        args: [gameAddress, deployment.vault, WAGER, gameData],
      }),
    });
    const sessionId = await pub.readContract({
      address: deployment.host,
      abi: hostAbi,
      functionName: 'currentSessionId',
    });

    // the VRF node fulfils asynchronously — poll for OUR session's settled event
    let settled: { payout: bigint; randomness: Hex; gameState: Hex; phase: number } | undefined;
    for (let i = 0; i < 60 && !settled; i++) {
      const logs = await pub.getLogs({
        address: deployment.host,
        event: hostAbi[2],
        fromBlock: 0n,
        toBlock: 'latest',
      });
      for (const log of logs) {
        const decoded = decodeEventLog({ abi: hostAbi, data: log.data, topics: log.topics });
        const args = decoded.args as unknown as {
          sessionId: bigint;
          player: Address;
          game: Address;
          payout: bigint;
          randomness: Hex;
          gameState: Hex;
          phase: number;
        };
        if (
          args.sessionId === sessionId &&
          args.player.toLowerCase() === account.address.toLowerCase() &&
          args.game.toLowerCase() === gameAddress.toLowerCase()
        ) {
          settled = args;
        }
      }
      if (!settled) await new Promise(r => setTimeout(r, 400));
    }
    if (!settled) {
      check(false, `candle ${candle} ticket ${ticket}: session never settled (VRF node?)`);
      continue;
    }

    const [order, gCandle, gTicket, won, payout] = decodeAbiParameters(
      [
        { type: 'uint8[6]' },
        { type: 'uint8' },
        { type: 'uint8' },
        { type: 'bool' },
        { type: 'uint256' },
      ],
      settled.gameState,
    ) as [number[], number, number, boolean, bigint];

    const onchainOrder = (await pub.readContract({
      address: gameAddress,
      abi: gameAbi,
      functionName: 'deriveOrder',
      args: [settled.randomness],
    })) as readonly number[];
    const expectedPayout = await pub.readContract({
      address: gameAddress,
      abi: gameAbi,
      functionName: 'payoutFor',
      args: [WAGER, candle, ticket, won],
    });

    const tag = `candle ${candle}/ticket ${ticket}`;
    check(settled.phase === 3, `${tag}: phase is SETTLED`);
    check(gCandle === candle && gTicket === ticket, `${tag}: gameState echoes the bet`);
    check(
      new Set(order).size === 6 && order.every(c => c >= 0 && c <= 5),
      `${tag}: death order is a permutation`,
    );
    check(onchainOrder.join() === order.join(), `${tag}: gameState order == deriveOrder(word)`);
    check(
      won === (ticket === 0 ? order[5] === candle : [order[3], order[4], order[5]].includes(candle)),
      `${tag}: won flag matches the death order`,
    );
    check(payout === expectedPayout, `${tag}: payout matches payoutFor`);
    check(won ? payout > 0n : payout === 0n, `${tag}: payout/win coherence`);
    check(payout <= WAGER + maxReservedProfit, `${tag}: payout within the zero-slack cap`);

    seenOrders.add(order.join(''));
    rows.push(
      `${String(ticket).padStart(6)} ${String(candle).padStart(6)}  ` +
        `${order.map(c => c + 1).join('-')}   ${won ? 'WIN ' : 'LOSS'}  ` +
        `${won ? `${(Number(payout) / Number(WAGER)).toFixed(4)}x` : '       '}  ${payout}`,
    );
  }
}

console.log('ticket candle  death order   result  mult     payout (base units)');
console.log('------ ------  -----------   ------  -------  --------------------');
for (const row of rows) console.log(row);
console.log(
  `\n${rows.length}/12 sessions settled; ${seenOrders.size} distinct death orders; ` +
    `${rows.filter(r => r.includes('WIN ')).length} wins`,
);
if (failures > 0) {
  console.error(`\nE2E FAILED with ${failures} check(s)`);
  process.exit(1);
}
console.log(
  `\nE2E PASSED: 12/12 sessions settled through LocalCasinoHost with the real VRF node, ` +
    'every decoded gameState matches the on-chain decision',
);
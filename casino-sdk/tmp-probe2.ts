import { createPublicClient, http, parseAbi } from 'viem';
const pub = createPublicClient({ transport: http('http://127.0.0.1:8545') });
const names = ['CasinoSessionOpened','CasinoSessionAdvanced','CasinoSessionSettled'] as const;
const abi = parseAbi([
  'event CasinoSessionOpened(uint256 indexed sessionId, address indexed game, address indexed player, address vault, uint256 wager)',
  'event CasinoSessionAdvanced(uint256 indexed sessionId, uint32 indexed step, bytes32 requestId, bytes32 randomness, bytes session)',
  'event CasinoSessionSettled(uint256 indexed sessionId, address indexed game, address indexed player, uint8 phase, uint256 payout, bytes32 randomness, bytes gameState)',
]);
for (let i = 0; i < 3; i++) {
  const logs = await pub.getLogs({ address: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512', event: abi[i], fromBlock: 0n, toBlock: 'latest' });
  console.log(names[i], logs.length, 'first topics:', logs[0]?.topics?.[1] ?? 'none');
}

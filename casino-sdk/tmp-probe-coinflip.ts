// Phase-1 discovery probe: plays a full CoinflipGame round against the local
// node (in-memory Hardhat chain + real Verify Network VRF node) with no browser.
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, encodeAbiParameters, parseAbi, decodeEventLog, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const dev = JSON.parse(readFileSync(new URL('./simulator/local-node/deployed.json', import.meta.url), 'utf8'));
const chain = { id: dev.chainId, name: 'local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [dev.rpcUrl] } } };
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const pub = createPublicClient({ chain, transport: http(dev.rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(dev.rpcUrl), account });

const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const gameAbi = parseAbi([
  'function quoteCaps(uint256 wager, bytes gameData) view returns (uint256 maxEscrowStake, uint256 maxReservedProfit)',
  'function quoteRiskParams(uint256 wager, bytes gameData) view returns (uint256 maxPayout, uint256 probabilityWad, uint256 expectedPayout, uint256 bodyVarianceScaled)',
]);
const hostAbi = parseAbi([
  'function openSession(address game, address vault, uint256 wager, bytes gameData) returns (uint256 sessionId, bytes32 requestId)',
  'function submitAction(bytes encodedSession, bytes actionData) returns (bytes32 requestId)',
  'function cancelStuckRandomness(bytes encodedSession) returns (uint256 payout)',
  'function forfeitExpiredSession(bytes encodedSession) returns (uint256 payout)',
  'event CasinoSessionAdvanced(uint256 indexed sessionId, uint32 indexed step, bytes32 requestId, bytes32 randomness, bytes session)',
  'event CasinoSessionSettled(uint256 indexed sessionId, address indexed game, address indexed player, uint8 phase, uint256 payout, bytes32 randomness, bytes gameState)',
]);

const gameData = encodeAbiParameters([{ type: 'bool' }, { type: 'uint8' }, { type: 'uint8' }], [true, 3, 1]);
const wager = parseEther('10');

const caps = await pub.readContract({ address: dev.games[0].address, abi: gameAbi, functionName: 'quoteCaps', args: [wager, gameData] });
console.log('quoteCaps ->', caps);
await pub.simulateContract({ address: dev.token, abi: erc20, functionName: 'approve', args: [dev.host, wager], account });
const approveTx = await wallet.writeContract({ address: dev.token, abi: erc20, functionName: 'approve', args: [dev.host, wager] });
await pub.waitForTransactionReceipt({ hash: approveTx });
console.log('approved', approveTx);

const openTx = await wallet.writeContract({ address: dev.host, abi: hostAbi, functionName: 'openSession', args: [dev.games[0].address, dev.vault, wager, gameData] });
console.log('openSession tx', openTx);
const openReceipt = await pub.waitForTransactionReceipt({ hash: openTx });
console.log('open status', openReceipt.status, 'logs', openReceipt.logs.length);

// Poll for the settled event (the VRF node fulfils asynchronously).
for (let i = 0; i < 60; i++) {
  const logs = await pub.getLogs({ address: dev.host, event: hostAbi[5], fromBlock: 0n, toBlock: 'latest' });
  const last = logs.at(-1);
  if (last) {
    const decoded = decodeEventLog({ abi: hostAbi, data: last.data, topics: last.topics });
    console.log('SETTLED', JSON.stringify(decoded.args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
    break;
  }
  await new Promise(r => setTimeout(r, 500));
}

const advanced = await pub.getLogs({ address: dev.host, event: hostAbi[4], fromBlock: 0n, toBlock: 'latest' });
console.log('CasinoSessionAdvanced count', advanced.length);

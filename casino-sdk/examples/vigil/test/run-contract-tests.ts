#!/usr/bin/env tsx
/**
 * Runs the on-chain VigilGame test suite (PRD §9 tests 1–5) against the local Hardhat chain.
 *
 *   cd casino-sdk && npm run local-node          # chain + VRF + deployment (or `npm start`)
 *   npx tsx examples/vigil/test/run-contract-tests.ts
 *
 * It compiles `simulator/contracts/VigilGameTests.sol` with the exact settings the simulator's
 * watcher uses (solc, viaIR, optimizer runs 200), deploys it, and executes `run()` through
 * `eth_call`. Every assertion therefore runs on the real EVM against the real compiled
 * `VigilGame`; a failed assertion reverts `TestFailed` and this script exits non-zero.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import solc from 'solc';
import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const contractsDir = resolve(import.meta.dirname, '../../../simulator/contracts');
const deploymentPath = resolve(import.meta.dirname, '../../../simulator/local-node/deployed.json');
const file = 'VigilGameTests.sol';

function compile(): { abi: unknown[]; bytecode: `0x${string}` } {
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: { [file]: { content: readFileSync(resolve(contractsDir, file), 'utf8') } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
        },
      }),
      {
        import: (importPath: string) => {
          const sibling = resolve(contractsDir, importPath);
          if (sibling.startsWith(contractsDir)) {
            return { contents: readFileSync(sibling, 'utf8') };
          }
          return { error: `Import not found: ${importPath}` };
        },
      },
    ),
  ) as {
    errors?: Array<{ severity: string; formattedMessage: string }>;
    contracts?: Record<
      string,
      Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>
    >;
  };

  const error = (output.errors ?? []).find(e => e.severity === 'error');
  if (error) {
    console.error(error.formattedMessage);
    process.exit(1);
  }
  const contract = output.contracts?.[file]?.VigilGameTests;
  if (!contract) {
    console.error('VigilGameTests not found in compiler output');
    process.exit(1);
  }
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

const dev = JSON.parse(readFileSync(deploymentPath, 'utf8')) as {
  chainId: number;
  rpcUrl: string;
};
const chain = {
  id: dev.chainId,
  name: 'casino-sdk simulator',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [dev.rpcUrl] } },
} as const;
const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const pub = createPublicClient({ chain, transport: http(dev.rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(dev.rpcUrl), account });

const { abi, bytecode } = compile();
console.log(`compiled ${file}: ${(bytecode.length - 2) / 2} bytes of bytecode`);

const hash = await wallet.deployContract({ abi, bytecode, args: [] });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success' || !receipt.contractAddress) {
  console.error(`deploy failed: ${hash}`);
  process.exit(1);
}
const address = receipt.contractAddress as Address;
console.log(`deployed VigilGameTests at ${address} (tx ${hash})\n`);

try {
  const tests = ['test1', 'test2', 'test3', 'test4', 'test5', 'test5b'] as const;
  for (const name of tests) {
    const report = (await pub.readContract({
      address,
      abi,
      functionName: name,
      gas: 16_000_000n,
    })) as string;
    console.log(report);
  }
  console.log('\nALL PRD §9 CONTRACT TESTS PASSED (tests 1-5 + 5b)');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('CONTRACT TESTS FAILED');
  console.error(message);
  process.exit(1);
}

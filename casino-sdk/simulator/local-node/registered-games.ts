// Mirrors the host's whitelist events so a game registered by any tool (not only the
// contracts/ watcher) shows up in the harness's game picker.
import type { Address, PublicClient } from 'viem';
import { localCasinoHostAbi } from '../src/local-node/artifacts.ts';

const POLL_INTERVAL_MS = 1_000;

export type RegisteredGame = { name: string; address: Address };

export type RegisteredGamesWatcherOptions = {
  publicClient: PublicClient;
  host: Address;
  fromBlock: bigint;
  onGamesChanged: (games: RegisteredGame[]) => void;
};

export function watchRegisteredGames(options: RegisteredGamesWatcherOptions): () => void {
  const names = new Map<Address, string>();
  let nextBlock = options.fromBlock;
  let polling = false;

  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const latest = await options.publicClient.getBlockNumber();
      if (latest < nextBlock) return;
      const logs = await options.publicClient.getContractEvents({
        address: options.host,
        abi: localCasinoHostAbi,
        eventName: 'GameWhitelistUpdated',
        fromBlock: nextBlock,
        toBlock: latest,
      });
      nextBlock = latest + 1n;
      if (logs.length === 0) return;
      for (const { args } of logs) {
        if (!args.game || args.gameName === undefined) continue;
        if (args.whitelisted) names.set(args.game, args.gameName);
        else names.delete(args.game);
      }
      options.onGamesChanged([...names].map(([address, name]) => ({ name, address })));
    } catch {
      // Transient RPC error; the next tick retries the same range.
    } finally {
      polling = false;
    }
  };

  const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}

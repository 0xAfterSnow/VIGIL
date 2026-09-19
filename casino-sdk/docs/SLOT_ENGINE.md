# Slot engine

The slot engine is an optional add-on to the casino SDK, in `slot-engine/`. One shared
contract settles every slot title. A title is a settlement table per bet configuration, deployed as
a clone of the engine. You write no Solidity: you write a tier list, deploy it with one command and
build the frontend that shows the result.

Coming from Stake Engine? Follow [Migrating from Stake Engine](./MIGRATING_FROM_STAKE_ENGINE.md);
it converts your existing math export into a title.

## Run the example

From the SDK root, with your package manager (bun shown; npm, pnpm and yarn work the same):

```sh
bun install
bun run start:slots
```

Expect four processes:

| Process     | What it does                                                                        |
| ----------- | ----------------------------------------------------------------------------------- |
| `node`      | Local chain, VRF node and casino deployment on port 8545 (see Local Simulator).     |
| `simulator` | The host harness on port 3300.                                                      |
| `frontend`  | The Lucky Reels example frontend on port 3500.                                      |
| `title`     | Deploys the Lucky Reels title once the node is up, registers it, then exits with 0. |

Open `http://localhost:3300/?game=http://localhost:3500`, pick **Lucky Reels** in the game list
and spin. Every session settles through the local VRF node against the real engine bytecode.

`bun start` (coinflip) and `bun run start:slots` use the same ports; run one at a time. Set
`RPC_URL` to reuse a chain that is already running.

Check settlements against the reference sampler while the stack runs:

```sh
cd slot-engine
bun run e2e:simulator
```

Expect `25 sessions settled and matched the reference sampler`.

## Build your own title

Run every command below from `slot-engine/`. Keep the `--`: bun ignores it, npm needs it to pass
the arguments through.

1. **Write a tier list** per bet configuration: `prize,weight` lines. Prizes are multiples of the
   session wager, as decimals (`72.5`) or fractions (`1/3`); prize `0` carries the miss weight.

   ```csv
   prize,weight
   0,9000
   0.5,900
   72.6,9
   200,1
   ```

2. **Describe the title.** The first bet configuration is the base configuration; its RTP is the
   title RTP. `prizeDenominator` is optional and defaults to the smallest grid that holds every
   prize. `displayMapping` is optional.

   ```json
   {
     "name": "My Slot",
     "betConfigurations": [
       {
         "name": "base",
         "tierList": "base.csv",
         "displayMapping": "base.display-mapping.json"
       },
       { "name": "bonus", "tierList": "bonus.csv" }
     ]
   }
   ```

3. **Check the figures.** Expect exact RTP as a fraction, hit rate, top prize and chunk count for
   each bet configuration.

   ```sh
   bun run cli -- compile ../my-slot/title.json
   ```

4. **Check the display mapping.** Expect `0 prizes without seeds` for each configuration; any
   uncovered prize exits 1.

   ```sh
   bun run cli -- check-mapping ../my-slot/title.json
   ```

5. **Play it locally.** With `bun run start:slots` running, this deploys the title to the local
   chain, registers it in the harness game list and plays ten sessions:

   ```sh
   bun run e2e:simulator -- --title ../my-slot/title.json --sessions 10
   ```

   Expect `10 sessions settled and matched the reference sampler`. Then open
   `http://localhost:3300/?game=<your frontend URL>` and pick your title.

6. **Deploy.** Expect the title address and title RTP. The command fails if the chain derived
   different figures than the compiler.

   ```sh
   SLOT_ENGINE_PRIVATE_KEY=0x... bun run cli -- deploy ../my-slot/title.json \
     --rpc <url> --deployer <SlotTitleDeployer address>
   ```

7. **Hand off** the title address and your hosted frontend like any other game (see
   [Getting Started](./GETTING_STARTED.md)). The Chain.wtf maintainers whitelist the title.

## Build the frontend

The frontend is a normal casino SDK guest (see
[Building Casino Games](./CHAIN_WTF_CASINO_GAMES.md)). Three things are specific to slot titles:

- **Choose the bet configuration** with one byte of `gameData`: `0x` (or `0x00`) is the base
  configuration, `0x01` the second one in `title.json`, and so on.
- **Read the result** from the settled session: its `gameState` is 4 bytes holding the prize in
  units of that configuration's prize denominator. The payout is
  `wager × prizeUnits / prizeDenominator`, rounded down. A session still in flight has an empty
  `gameState`; only decode 4-byte states.
- **Pick what to show** with `pickDisplaySeed(mapping, prizeUnits, randomness)` from
  `slot-engine/src/display.ts`. Every client derives the same seed for the same session. The seed
  is an opaque string your frontend knows how to render, such as reel stops or a book id.

`slot-engine/example/frontend/src/App.tsx` does all three.

In the Chain monorepo the add-on is its own package, `packages/slot-engine`, and `vp run start`
there runs the same stack. The SDK download ships a copy of it as `slot-engine/`.

## Commands

| Command (in `slot-engine/`)                     | Does                                                         |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `bun start`                                     | Same as `bun run start:slots` at the SDK root.               |
| `bun run cli -- compile <title.json>`           | Prints each bet configuration's exact figures.               |
| `bun run cli -- check-mapping <title.json>`     | Checks the display mappings cover every prize.               |
| `bun run cli -- deploy <title.json> …`          | Deploys the title (needs `SLOT_ENGINE_PRIVATE_KEY`).         |
| `bun run cli -- decode <address> --rpc <url>`   | Rebuilds tier lists and RTP from a live title's chain bytes. |
| `bun run cli -- import-stake <dir> --out <dir>` | Converts a Stake Engine math export into a title.            |
| `bun run e2e:simulator`                         | Plays real sessions on the running local stack.              |
| `bun run example:generate`                      | Regenerates the Lucky Reels tier list and display mapping.   |
| `bun test`                                      | Contracts, compiler, sampler, display picker and importer.   |
| `bun run check-types`                           | Type checks, including the example frontend.                 |

## Verify a live title

```sh
bun run cli -- decode <title address> --rpc <url> --out ./decoded
```

Expect `quoted figures match the table` for each bet configuration, and one tier list CSV per
configuration rebuilt from the chunk bytes.

## Rules the chain enforces

- **RTP.** `SlotTitleDeployer` walks every chunk and derives total weight, prize sum, top prize
  and body variance itself. It rejects any table at or above 100% RTP, and any table outside its
  owner's RTP band: 85% to 98% by default, bounds included.
- **Sizes.** Winning weights must sum to at most 2³² − 1; the miss weight can use 64 bits. A prize
  must fit 32 bits of prize units. A chunk holds at most 3,071 prizes; larger tables span several
  chunks. A title holds at most 255 bet configurations.
- **Risk quotes** are exact from the table: top-prize probability and body variance round up. See
  [Slots Risk & Reserves](./SLOTS_RISK_AND_RESERVES.md) for what they feed.

## Reference

### The example: Lucky Reels

`slot-engine/example/` is a complete title: three reels, three rows, five lines, one roll.

- `game.ts` holds the reel strips and paytable. The generator and the frontend share it; the
  chain never sees it.
- `generate.ts` enumerates every reel stop combination into `base.csv` (the settlement table) and
  `display-mapping.json` (reel stops per prize). Win weights are combination counts; the miss
  weight is set so the table pays exactly 96%.
- `title.json` names the bet configuration, pins its prize denominator and points at both files.
- `frontend/` is the guest iframe: it decodes the prize, picks reel stops with `pickDisplaySeed`,
  spins to them and reveals the outcome.

### File formats

- **Display mapping.** `{ "prizeDenominator": 10, "seeds": { "<prizeUnits>": ["<seed>", …] } }`,
  one per bet configuration. Seed counts are not odds and never feed a tier list; the tier list
  alone decides what a session pays.
- **Chunk.** A data contract: one `STOP` byte, then 8-byte tiers of
  `uint32 prizeUnits ‖ uint32 cumulativeWeight`, prizes strictly ascending.

### Measured gas

Two-chunk table of 4,534 prizes, production casino facet with the Verify Network router, steady
state: about 494k for a miss (307k open, 188k settle) and 515k for a hit. The first round of a
title costs about 630k while the facet initialises its per-game risk storage. Deployment is about
7.9M for two chunks plus 1.4M for the title.

# Migrating from Stake Engine

A Stake Engine slot moves to the Chain [slot engine](./SLOT_ENGINE.md) without redoing its math.
The importer converts your math export into a title. Each bet mode becomes a bet configuration,
and the lookup table weights become an on-chain settlement table with the same RTP. Your books
become what the frontend replays. The frontend keeps its animations; only the RGS client is
replaced by the casino SDK host bridge.

## Migrate a game

Run every command from the SDK's `slot-engine/` folder after installing at the SDK root
(bun shown; npm, pnpm and yarn work the same; keep the `--` before arguments).

1. **Export the math.** Run your game in the Stake math SDK as you would for a Stake upload. The
   importer reads the upload folder, `games/<game>/library/publish_files/`:

   ```text
   index.json
   lookUpTable_base_0.csv     books_base.jsonl.zst
   lookUpTable_bonus_0.csv    books_bonus.jsonl.zst
   ```

2. **Import it.**

   ```sh
   bun run cli -- import-stake <math-sdk>/games/<game>/library/publish_files \
     --out ../my-slot --name "My Slot"
   ```

   Expect one block per mode, with `imported RTP` matching `source RTP`. A mode that never pays 0
   (bonus buys, typically) can drift by a few millionths of a percent:

   ```text
   base
     source RTP     96.700000%
     imported RTP   96.700000%  (weights rescaled to 32 bits)
     books          1348 written
   bonus
     source RTP     96.700000%
     imported RTP   96.699940%  (weights rescaled to 32 bits)
     books          8166 written
   ```

   `../my-slot/` now holds `title.json`, a tier list and a display mapping per mode, and
   `books/<mode>/<id>.json`.

3. **Check the title.** Expect every mode's RTP inside 85% to 98%, and `0 prizes without seeds`
   for every mode.

   ```sh
   bun run cli -- compile ../my-slot/title.json
   bun run cli -- check-mapping ../my-slot/title.json
   ```

4. **Port the frontend** (next section) and serve `../my-slot/books/` from its public folder at
   `/books/`.

5. **Play it locally.** Start the stack from the SDK root with `bun run start:slots`, then:

   ```sh
   bun run e2e:simulator -- --title ../my-slot/title.json --sessions 10
   ```

   Expect `10 sessions settled and matched the reference sampler`. Open
   `http://localhost:3300/?game=<your frontend URL>` and pick your title in the game list.

6. **Deploy and hand off** as in [Slot engine → Build your own title](./SLOT_ENGINE.md), steps 6
   and 7.

## Port the frontend

Your Stake frontend talks to the RGS. On Chain it talks to the host through
`@chain/casino-sdk/guest`, and the host signs every transaction. Keep the renderer that plays a
book's `events`; replace the RGS client with this flow:

```ts
import { connectGameToHost, type HostSnapshotV1 } from '@chain/casino-sdk/guest';
import { hexToBigInt, toHex, type Hex } from 'viem';
import { parseDisplayMapping, pickDisplaySeed } from './slot-engine/display';
import baseMapping from './my-slot/base.display-mapping.json';
import bonusMapping from './my-slot/bonus.display-mapping.json';

// Same order as title.json, which follows index.json.
const MODES = [
  { name: 'base', cost: 1n, mapping: parseDisplayMapping(baseMapping) },
  { name: 'bonus', cost: 100n, mapping: parseDisplayMapping(bonusMapping) },
];

const host = await connectGameToHost({
  async setState(snapshot) {
    onSnapshot(snapshot);
  },
}).promise;

// Replaces POST /wallet/play. The wager is what the player pays: base bet × mode cost.
async function play(modeIndex: number, baseBet: bigint) {
  const { sessionKey } = await host.openSession({
    wager: (baseBet * MODES[modeIndex].cost).toString(),
    gameData: modeIndex === 0 ? '0x' : toHex(modeIndex, { size: 1 }),
  });
  return sessionKey;
}

// Replaces the play response: when your session settles, load a book with the same payout.
async function bookFor(modeIndex: number, gameState: Hex, randomness: Hex) {
  const mode = MODES[modeIndex];
  const bookId = pickDisplaySeed(mode.mapping, hexToBigInt(gameState), randomness);
  return (await fetch(`/books/${mode.name}/${bookId}.json`)).json();
}

function onSnapshot(snapshot: HostSnapshotV1) {
  // Find your session in snapshot.sessions.items by sessionKey. Once it is settled and
  // raw.gameState is 4 bytes, call bookFor(modeIndex, raw.gameState, raw.randomness), play
  // book.events, then replace POST /wallet/end-round with:
  //   host.revealOutcome({ sessionId: row.sessionId })
}
```

`display.ts` is `slot-engine/src/display.ts`: copy it and `compile.ts`, which it takes a type
from, into your frontend, or import it by relative path as the example does. The complete working
version of this loop, including in-flight and cancelled sessions, is
`slot-engine/example/frontend/src/App.tsx`.

| Stake RGS                                 | Chain casino SDK                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `sessionID`, `rgs_url` URL params         | Nothing; the host connects to your iframe.                                               |
| `/wallet/authenticate`                    | The first snapshot: `wallet`, `balances`, `token`.                                       |
| `/wallet/balance`                         | `snapshot.balances.smartVaultBalance`, pushed on every change.                           |
| `/wallet/play` with `mode` and `amount`   | `openSession({ wager, gameData })`, with `wager` = base bet × cost.                      |
| The round's book                          | Settled `gameState` → `pickDisplaySeed` → `/books/<mode>/<id>.json`.                     |
| `/wallet/end-round`                       | `revealOutcome({ sessionId })` after your win animation. The payout is already on chain. |
| `/bet/event`, resuming an active round    | `snapshot.sessions.items` lists the player's sessions, open ones included.               |
| `minBet`, `maxBet`, `stepBet`, bet levels | `computeMaxWager(snapshot, { maxMultiplierX })` for the live cap; your own levels.       |
| Amounts with 6 decimals                   | Token base units; `snapshot.token.decimals` (18 for chUSD).                              |
| `lang` URL param                          | `snapshot.ui.locale`; see [Visual & UX](./VISUAL_AND_UX.md).                             |

Also add a `game.manifest.json` next to your `index.html`; see
[Building Casino Games](./CHAIN_WTF_CASINO_GAMES.md). The Stake web SDK's Svelte stack works
as-is; any static build the host can load in an iframe does.

## How the conversion works

| Stake Engine                     | Chain slot engine                                                    |
| -------------------------------- | -------------------------------------------------------------------- |
| Bet mode in `index.json`         | Bet configuration, same order; the first is the base configuration.  |
| Mode `cost`                      | Folded into the wager. Prizes are multiples of the mode's own wager. |
| `payoutMultiplier` (hundredths)  | Prize = `payoutMultiplier / (100 × cost)`.                           |
| Lookup table rows                | Summed by payout into one tier per distinct prize.                   |
| Books                            | Display seeds: a sample of book ids per prize.                       |
| RTP checked by the RGS on upload | RTP derived on chain by `SlotTitleDeployer` at deploy.               |

- **Who decides the outcome.** On Stake the RGS draws a book. On Chain the engine draws a prize
  from the tier list with verifiable randomness, and the frontend then shows a book with exactly
  that payout. Books never affect odds or payouts.
- **Weight rescaling.** Stake weights are `uint64`; the engine's winning weights must sum to at
  most 2³² − 1. When they don't fit, the importer scales winning weights down, keeps every prize
  (a rare prize keeps weight 1 at minimum), and solves the miss weight so the RTP matches the
  source. Probabilities of individual prizes shift by the rounding; the output reports the RTP.
- **Which books are kept.** For each prize the importer keeps up to `--seeds-per-prize` book ids
  (default 16), chosen in proportion to their lookup-table weight. A prize reached by both a base
  win and a free-spins round is therefore shown in the same mix as on Stake. Raise the count for
  more variety; lower it to shrink `books/`. Tested on the math SDK's `0_0_lines` sample, the
  default wrote about 9,500 books (98 MB), each fetched on its own.
- **Fractional prizes.** A cost like `3` makes prizes such as `1/3`; tier lists accept fractions,
  and the compiler picks a prize denominator that holds them exactly.
- **Compressed books.** Reading `.jsonl.zst` needs Node 22.15 or newer. On older Node, run
  `zstd -d` on the books files first; the importer falls back to the uncompressed `.jsonl`.

## What does not carry over

- **Stake's RTP rules.** Stake requires 90% to 98% per mode, within 0.5% across modes. Chain
  requires each configuration to sit in the deployer's band (85% to 98% by default) and treats
  the base configuration's RTP as the title RTP.
- **Jurisdiction flags** (`socialCasino`, `disabledTurbo`, and the rest) have no equivalent.
- **Criteria and force files** are math SDK tooling and stay there. Keep them in your math repo and
  rerun the import after each math change.

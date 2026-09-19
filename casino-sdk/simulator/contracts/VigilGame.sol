// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ICasinoGameV2, SessionContext, SessionPhase, StepResult } from './ICasinoGameV2.sol';

/// @title VIGIL — six candles, one survivor
/// @notice One verified random word decides the order in which six candles are snuffed out.
///         Death weights are `d = [1,2,3,4,5,6]`, so a higher-weight candle tends to die earlier.
///         The order is exactly the death order of six independent exponential lifetimes
///         (a Plackett–Luce process): six sequential draws without replacement, each draw
///         proportional to the surviving weight.
///
///         Tickets (chosen with the candle in `gameData = abi.encode(uint8 candle, uint8 ticket)`):
///           0 LAST LIT    — your candle is the last one burning.
///           1 FINAL THREE — your candle outlasts three others.
///
///         Every ticket pays `wager * 0.96 / P(win)`, so the RTP is exactly 96% on all twelve.
///         The constants come from `vigil_math.py` (exact rational enumeration of the 720 orders).
///
/// @dev Storage-free: every hook is `pure`/`view` and a pure function of `(wager, gameData)`.
contract VigilGame is ICasinoGameV2 {
  // ----------------------------------------------------------------- constants

  uint8 internal constant CANDLE_COUNT = 6;
  uint8 internal constant LAST_LIT = 0;
  uint8 internal constant FINAL_THREE = 1;

  /// @dev RTP = 96/100 on every ticket (PRD §3.3, §6).
  uint256 internal constant RTP_PERCENT = 96;
  uint256 internal constant PERCENT = 100;
  uint256 internal constant PROBABILITY_WAD = 1e18;

  /// @dev Common denominator of all 720 exact order probabilities — from `vigil_math.py`.
  uint256 internal constant D = 2053230379200;

  /// @dev `P(candle is last lit) = LAST_NUM_* / D`. The six numerators sum to `D`.
  uint256 internal constant LAST_NUM_0 = 1084606372080;
  uint256 internal constant LAST_NUM_1 = 458051106240;
  uint256 internal constant LAST_NUM_2 = 236773817280;
  uint256 internal constant LAST_NUM_3 = 136008421920;
  uint256 internal constant LAST_NUM_4 = 83680014600;
  uint256 internal constant LAST_NUM_5 = 54110647080;

  /// @dev `P(candle survives the first 3 deaths) = FINAL3_NUM_* / D`. Sums to `3 * D`.
  uint256 internal constant FINAL3_NUM_0 = 1682359451640;
  uint256 internal constant FINAL3_NUM_1 = 1353394178640;
  uint256 internal constant FINAL3_NUM_2 = 1072234928520;
  uint256 internal constant FINAL3_NUM_3 = 843998712480;
  uint256 internal constant FINAL3_NUM_4 = 669859331400;
  uint256 internal constant FINAL3_NUM_5 = 537844534920;

  /// @dev Rejection-sampling domain: the random word is read as sixteen 16-bit windows.
  uint256 internal constant WINDOW_DOMAIN = 1 << 16; // 65536
  uint256 internal constant WINDOWS_PER_WORD = 16; // 32 bytes / 2 bytes per window
  uint256 internal constant LIT_MASK_ALL = 0x3F; // candles 0..5 all burning

  // -------------------------------------------------------------------- errors

  error VigilGame__InvalidCandle(uint8 candle);
  error VigilGame__InvalidTicket(uint8 ticket);
  error VigilGame__InvalidGameData();
  error VigilGame__NoPlayerAction();

  // ------------------------------------------------------- ICasinoGameV2 hooks

  /// @inheritdoc ICasinoGameV2
  /// @dev Escrow never grows (there is no mid-round action), so `maxEscrowStake == wager`.
  ///      `maxReservedProfit` is the worst-case payout above the stake, derived from the *same*
  ///      `_payout` the settling step uses — the facet's payout cap is zero-slack.
  function quoteCaps(
    uint256 wager,
    bytes calldata gameData
  ) external pure returns (uint256 maxEscrowStake, uint256 maxReservedProfit) {
    (uint8 candle, uint8 ticket) = _decodeGameData(gameData);
    uint256 maxPayout = _payout(wager, candle, ticket, true);
    return (wager, maxPayout > wager ? maxPayout - wager : 0);
  }

  /// @inheritdoc ICasinoGameV2
  /// @dev One winning tier per bet (pay or nothing), so the body variance — the variance left
  ///      after that tier is removed — is exactly 0, the shape the SDK allows to return 0.
  ///      The worst case, 36.4272x, is far below the 100x heavy-tail threshold.
  function quoteRiskParams(
    uint256 wager,
    bytes calldata gameData
  )
    external
    pure
    returns (
      uint256 maxPayout,
      uint256 probabilityWad,
      uint256 expectedPayout,
      uint256 bodyVarianceScaled
    )
  {
    (uint8 candle, uint8 ticket) = _decodeGameData(gameData);
    return (
      _payout(wager, candle, ticket, true),
      (_numerator(ticket, candle) * PROBABILITY_WAD) / D,
      (wager * RTP_PERCENT) / PERCENT,
      0
    );
  }

  /// @inheritdoc ICasinoGameV2
  /// @dev Instant game: open straight into the randomness wait and commit the whole reserve here.
  function onSessionStart(
    SessionContext calldata ctx
  ) external pure returns (StepResult memory stepResult) {
    (uint8 candle, uint8 ticket) = _decodeGameData(ctx.gameData);
    uint256 maxPayout = _payout(ctx.wagerBase, candle, ticket, true);

    stepResult.newGameState = abi.encode(_emptyOrder(), candle, ticket, false, uint256(0));
    stepResult.reservedProfitDelta = int256(
      maxPayout > ctx.wagerBase ? maxPayout - ctx.wagerBase : 0
    );
    stepResult.nextPhase = SessionPhase.WAITING_RANDOMNESS;
    stepResult.requestRandomnessNow = true;
  }

  /// @inheritdoc ICasinoGameV2
  /// @dev VIGIL has no player steps. The function still exists so the simulator's watcher registers
  ///      the contract as a game (it keys on `quoteCaps` + `onPlayerAction`) and so this game can
  ///      never leave the facet in `WAITING_PLAYER_ACTION`.
  function onPlayerAction(
    SessionContext calldata,
    bytes calldata
  ) external pure returns (StepResult memory) {
    revert VigilGame__NoPlayerAction();
  }

  /// @inheritdoc ICasinoGameV2
  /// @dev The only randomness consumer: sample the six-death order, read the ticket, settle.
  ///      `escrowDelta` and `reservedProfitDelta` stay 0 — the facet releases the reserve itself,
  ///      and releasing it here would shrink the cap and revert every win above 1x.
  function onRandomness(
    SessionContext calldata ctx,
    bytes32 randomness
  ) external pure returns (StepResult memory stepResult) {
    (uint8 candle, uint8 ticket) = _decodeGameData(ctx.gameData);
    uint8[6] memory order = _sampleOrder(randomness);
    bool won = _won(order, candle, ticket);
    uint256 payout = _payout(ctx.wagerBase, candle, ticket, won);

    stepResult.newGameState = abi.encode(order, candle, ticket, won, payout);
    stepResult.payout = payout;
    stepResult.nextPhase = SessionPhase.SETTLED;
  }

  /// @inheritdoc ICasinoGameV2
  /// @dev 0 by design: mid-round value depends on randomness that has not been revealed yet, so any
  ///      concrete quote would be an adverse-selection put option against the vault.
  function quoteForfeitPayout(SessionContext calldata) external pure returns (uint256) {
    return 0;
  }

  // ------------------------------------------------------------- audit surface
  // These are the same internal code paths the hooks use (not re-derivations), exposed so the
  // sampler, the paytable and the single-payout invariant can be proved on-chain without a fork.

  /// @notice The death order the word produces: `order[0]` dies first, `order[5]` is the survivor.
  function deriveOrder(bytes32 randomness) external pure returns (uint8[6] memory) {
    return _sampleOrder(randomness);
  }

  /// @notice Cumulative-weight mapper: the candle in `survivorsMask` whose interval contains `r`,
  ///         scanning ascending index. Each candle `c` owns exactly `d_c = c + 1` of the values.
  function mapDraw(uint8 survivorsMask, uint256 r) public pure returns (uint8) {
    for (uint8 c = 0; c < CANDLE_COUNT; c++) {
      if (survivorsMask & (uint8(1) << c) == 0) continue;
      uint256 weight = uint256(c) + 1;
      if (r < weight) return c;
      r -= weight;
    }
    revert VigilGame__InvalidGameData();
  }

  /// @notice The one and only payout function, in the open. `won == false` pays 0.
  function payoutFor(
    uint256 wager,
    uint8 candle,
    uint8 ticket,
    bool won
  ) public pure returns (uint256) {
    _validate(candle, ticket);
    return _payout(wager, candle, ticket, won);
  }

  /// @notice Worst-case multiplier in basis points, ceiled — what the client clamps wagers with.
  function maxMultiplierBps(uint8 candle, uint8 ticket) public pure returns (uint256) {
    _validate(candle, ticket);
    uint256 denominator = PERCENT * _numerator(ticket, candle);
    uint256 scaled = RTP_PERCENT * D * 10_000;
    return (scaled + denominator - 1) / denominator;
  }

  /// @notice `P(win)` numerators for a ticket, over all six candles (denominator: `D`).
  function probabilityNumerators(uint8 ticket) public pure returns (uint256[6] memory numerators) {
    if (ticket > FINAL_THREE) revert VigilGame__InvalidTicket(ticket);
    for (uint8 candle = 0; candle < CANDLE_COUNT; candle++) {
      numerators[candle] = _numerator(ticket, candle);
    }
  }

  /// @notice Denominator for `probabilityNumerators`.
  function probabilityDenominator() external pure returns (uint256) {
    return D;
  }

  // ------------------------------------------------------------ payout + math

  /// @dev THE payout function. Every hook that quotes, caps, reserves or settles calls this.
  ///      On a win: `floor(wager * 96 * D / (100 * NUM))` — floored once, house-favouring by at
  ///      most one base unit, so `P(win) * payout <= 0.96 * wager` always holds.
  function _payout(
    uint256 wager,
    uint8 candle,
    uint8 ticket,
    bool won
  ) internal pure returns (uint256) {
    if (!won) return 0;
    return (wager * RTP_PERCENT * D) / (PERCENT * _numerator(ticket, candle));
  }

  function _numerator(uint8 ticket, uint8 candle) internal pure returns (uint256) {
    if (candle >= CANDLE_COUNT) revert VigilGame__InvalidCandle(candle);
    if (ticket == LAST_LIT) {
      if (candle == 0) return LAST_NUM_0;
      if (candle == 1) return LAST_NUM_1;
      if (candle == 2) return LAST_NUM_2;
      if (candle == 3) return LAST_NUM_3;
      if (candle == 4) return LAST_NUM_4;
      return LAST_NUM_5;
    }
    if (ticket == FINAL_THREE) {
      if (candle == 0) return FINAL3_NUM_0;
      if (candle == 1) return FINAL3_NUM_1;
      if (candle == 2) return FINAL3_NUM_2;
      if (candle == 3) return FINAL3_NUM_3;
      if (candle == 4) return FINAL3_NUM_4;
      return FINAL3_NUM_5;
    }
    revert VigilGame__InvalidTicket(ticket);
  }

  function _won(uint8[6] memory order, uint8 candle, uint8 ticket) internal pure returns (bool) {
    if (ticket == LAST_LIT) return order[5] == candle;
    return order[3] == candle || order[4] == candle || order[5] == candle;
  }

  function _emptyOrder() internal pure returns (uint8[6] memory order) {
    return order;
  }

  // --------------------------------------------------------------- the sampler

  /// @dev Six sequential weighted draws without replacement.
  ///      For the draw with total remaining weight `W`: take the next unused 16-bit window `v`;
  ///      reject it when `v >= floor(65536 / W) * W` and take the next window instead; otherwise
  ///      `r = v % W`. `%` only ever runs *after* the rejection test — never a bare byte % n.
  ///      Windows come from one continuous stream: the first sixteen from the word, then
  ///      `keccak256(abi.encode(word, 1))`, `keccak256(abi.encode(word, 2))`, … The client mirror
  ///      walks the identical stream. Exhaustion is astronomically unlikely: the worst per-window
  ///      rejection probability here is 4/65536 ≈ 0.006%.
  function _sampleOrder(bytes32 randomness) internal pure returns (uint8[6] memory order) {
    uint256 litMask = LIT_MASK_ALL;
    uint256 cursor;

    for (uint256 i = 0; i < CANDLE_COUNT; i++) {
      uint256 totalWeight = _maskWeight(litMask);
      uint256 limit = (WINDOW_DOMAIN / totalWeight) * totalWeight;
      uint256 value = _windowAt(randomness, cursor);
      cursor++;

      while (value >= limit) {
        value = _windowAt(randomness, cursor);
        cursor++;
      }

      uint8 candle = mapDraw(uint8(litMask), value % totalWeight);
      order[i] = candle;
      litMask &= ~(uint256(1) << candle);
    }
  }

  /// @dev Sum of the death weights of the candles still lit (weight of candle `c` is `c + 1`).
  function _maskWeight(uint256 mask) internal pure returns (uint256 total) {
    for (uint8 c = 0; c < CANDLE_COUNT; c++) {
      if (mask & (uint256(1) << c) != 0) total += uint256(c) + 1;
    }
  }

  /// @dev The `cursor`-th 16-bit window of the expanded stream (big-endian byte pairs).
  function _windowAt(bytes32 randomness, uint256 cursor) internal pure returns (uint256) {
    uint256 blockIndex = cursor / WINDOWS_PER_WORD;
    uint256 byteOffset = (cursor % WINDOWS_PER_WORD) * 2;
    bytes32 word = blockIndex == 0 ? randomness : keccak256(abi.encode(randomness, blockIndex));
    return (uint256(uint8(word[byteOffset])) << 8) | uint256(uint8(word[byteOffset + 1]));
  }

  // ---------------------------------------------------------------- game data

  /// @dev `gameData = abi.encode(uint8 candle, uint8 ticket)`; reverts outside the domain.
  function _decodeGameData(bytes calldata gameData) internal pure returns (uint8, uint8) {
    if (gameData.length != 64) revert VigilGame__InvalidGameData();
    (uint8 candle, uint8 ticket) = abi.decode(gameData, (uint8, uint8));
    _validate(candle, ticket);
    return (candle, ticket);
  }

  function _validate(uint8 candle, uint8 ticket) internal pure {
    if (candle >= CANDLE_COUNT) revert VigilGame__InvalidCandle(candle);
    if (ticket > FINAL_THREE) revert VigilGame__InvalidTicket(ticket);
  }
}
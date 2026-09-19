// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { VigilGame } from './VigilGame.sol';
import { SessionContext, StepResult, SessionPhase } from './ICasinoGameV2.sol';

/// @notice On-chain test suite for `VigilGame` — PRD §9 tests 1–5.
///
///         Deployed to the local Hardhat chain by `examples/vigil/test/run-contract-tests.ts` and
///         executed through `eth_call`, so every assertion runs on the real EVM with the real
///         compiled `VigilGame`. A failed assertion reverts `TestFailed`, which makes the
///         `eth_call` fail — the runner printing the revert reason IS the failure output.
///
/// @dev The watcher in `simulator/local-node` also compiles this file (it is not a game, so it is
///      never deployed there), which is why it must stay importable with the harness settings.
contract VigilGameTests {
  error TestFailed(string what);

  VigilGame internal immutable game;

  uint256 internal constant D = 2053230379200;
  uint256 internal constant CANDLE_COUNT = 6;

  constructor() {
    game = new VigilGame();
  }

  /// @notice PRD §9 test 1 — exhaustive 720-order paytable exactness.
  function test1() external view returns (string memory) {
    return _test1PaytableExactness();
  }

  /// @notice PRD §9 test 2 — mapper preimage counts over all 63 survivor subsets.
  function test2() external view returns (string memory) {
    return _test2SamplerMapper();
  }

  /// @notice PRD §9 test 3 — exact 96% RTP on all 12 tickets.
  function test3() external view returns (string memory) {
    return _test3Rtp();
  }

  /// @notice PRD §9 test 4 — one payout function across every hook.
  function test4() external view returns (string memory) {
    return _test4SinglePayoutFunction();
  }

  /// @notice PRD §9 test 5 — invalid candle/ticket/gameData revert.
  function test5() external view returns (string memory) {
    return _test5Reverts();
  }

  /// @notice Sampler well-formedness on adversarial words.
  function test5b() external view returns (string memory) {
    return _test5bSamplerWellformed();
  }

  // ------------------------------------------------------------------- test 1

  /// @dev Brute-force all 720 orders with exact rational leaf probabilities in the D-scaled
  ///      integer domain (every order's denominator divides D, so `D / denom` is exact), then
  ///      compare against the on-chain ticket numerators.
  function _test1PaytableExactness() internal view returns (string memory) {
    uint256[6] memory weights = _weights();
    uint256[] memory remaining = new uint256[](6);
    for (uint256 i = 0; i < 6; i++) remaining[i] = i;

    uint256[6] memory lastAcc;
    uint256[6] memory final3Acc;
    uint256[6] memory order;
    uint256[] memory counters = new uint256[](2); // [0] permutations, [1] failures
    _enumerate(weights, remaining, 0, 1, 1, order, lastAcc, final3Acc, counters);

    _assert(counters[0] == 720, "test1: permutation count is not 720");

    uint256 sumLast;
    uint256 sumFinal3;
    for (uint8 c = 0; c < CANDLE_COUNT; c++) {
      sumLast += lastAcc[c];
      sumFinal3 += final3Acc[c];
    }
    _assert(sumLast == D, "test1: enumerated P(last) numerators do not sum to D");
    _assert(sumFinal3 == 3 * D, "test1: enumerated P(final3) numerators do not sum to 3D");
    _assert(game.probabilityDenominator() == D, "test1: contract denominator != vigil_math D");

    uint256[6] memory onchainLast = game.probabilityNumerators(0);
    uint256[6] memory onchainFinal3 = game.probabilityNumerators(1);
    for (uint8 c = 0; c < CANDLE_COUNT; c++) {
      _assert(lastAcc[c] == onchainLast[c], "test1: LAST_NUM mismatch vs enumeration");
      _assert(final3Acc[c] == onchainFinal3[c], "test1: FINAL3_NUM mismatch vs enumeration");
    }

    return
      "TEST 1 paytable-exactness: PASS (720 orders, sum(last)=D, sum(final3)=3D, 12/12 numerators match)";
  }

  /// @dev Recursive permutation walk over the six candles. `denom` is the product of the
  ///      remaining-weight totals along the prefix and `prodD` the product of the prefix death
  ///      weights, so a leaf's exact probability is `prodD / denom`. Because every leaf's reduced
  ///      denominator divides `D` (that is what `D` is), `D * prodD / denom` is an exact integer —
  ///      the leaf's numerator over `D`. No rounding, no simulation.
  function _enumerate(
    uint256[6] memory weights,
    uint256[] memory remaining,
    uint256 depth,
    uint256 denom,
    uint256 prodD,
    uint256[6] memory order,
    uint256[6] memory lastAcc,
    uint256[6] memory final3Acc,
    uint256[] memory counters
  ) internal pure {
    if (depth == 6) {
      counters[0] += 1;
      uint256 numerator = (D * prodD) / denom;
      _assert(
        (numerator * denom) / D == prodD && (numerator * denom) % D == 0,
        "test1: leaf probability does not scale exactly by D"
      );
      lastAcc[order[5]] += numerator;
      final3Acc[order[3]] += numerator;
      final3Acc[order[4]] += numerator;
      final3Acc[order[5]] += numerator;
      return;
    }

    uint256 total;
    for (uint256 i = 0; i < remaining.length; i++) total += weights[remaining[i]];

    for (uint256 i = 0; i < remaining.length; i++) {
      uint256[] memory next = new uint256[](remaining.length - 1);
      uint256 k;
      for (uint256 j = 0; j < remaining.length; j++) {
        if (j != i) next[k++] = remaining[j];
      }
      uint8 candle = uint8(remaining[i]);
      order[depth] = candle;
      _enumerate(
        weights,
        next,
        depth + 1,
        denom * total,
        prodD * weights[candle],
        order,
        lastAcc,
        final3Acc,
        counters
      );
    }
  }

  // ------------------------------------------------------------------- test 2

  /// @dev For every reachable survivor subset (63 non-empty masks) and every `r` in `[0, W)`, the
  ///      cumulative-weight mapper must return candle `c` exactly `d_c = c + 1` times, and never a
  ///      candle that is already dead.
  function _test2SamplerMapper() internal view returns (string memory) {
    uint256 subsets;
    uint256 values;
    for (uint256 mask = 1; mask < 64; mask++) {
      subsets += 1;
      uint256 total = _maskWeight(mask);
      uint256[6] memory counts;
      for (uint256 r = 0; r < total; r++) {
        uint8 candle = game.mapDraw(uint8(mask), r);
        _assert(candle < CANDLE_COUNT, "test2: mapper returned an out-of-range candle");
        _assert(mask & (uint256(1) << candle) != 0, "test2: mapper returned a dead candle");
        counts[candle] += 1;
        values += 1;
      }
      for (uint8 c = 0; c < CANDLE_COUNT; c++) {
        uint256 expected = mask & (uint256(1) << c) != 0 ? uint256(c) + 1 : 0;
        _assert(counts[c] == expected, "test2: preimage count != death weight");
      }
    }
    _assert(subsets == 63, "test2: did not sweep all 63 survivor subsets");
    return _cat(
      _cat("TEST 2 sampler-mapper: PASS (63 subsets, ", _toString(values)),
      " r-values, preimage count == d_c for every candle)"
    );
  }

  // ------------------------------------------------------------------- test 3

  /// @dev For all 12 tickets: the integer payout is exactly `floor(wager * 96 * D / (100 * NUM))`,
  ///      so it never exceeds the exact 96% value and is maximal — no base unit left on the table.
  ///      With `sum(NUM) == D` (test 1) this is the exact rational 96% RTP over the whole bet set.
  function _test3Rtp() internal view returns (string memory) {
    uint256[8] memory wagers = _wagerLadder();
    uint256 checks;
    for (uint256 w = 0; w < wagers.length; w++) {
      uint256 wager = wagers[w];
      for (uint8 ticket = 0; ticket <= 1; ticket++) {
        for (uint8 candle = 0; candle < CANDLE_COUNT; candle++) {
          uint256 numerator = _numerator(ticket, candle);
          uint256 payout = game.payoutFor(wager, candle, ticket, true);
          uint256 exactNumerator = wager * 96 * D;
          uint256 exactDenominator = 100 * numerator;

          _assert(
            payout * exactDenominator <= exactNumerator,
            "test3: payout exceeds the exact 96% value"
          );
          _assert(
            (payout + 1) * exactDenominator > exactNumerator,
            "test3: payout is not the floor of the exact value"
          );
          checks += 1;
        }
      }
    }
    _assert(checks == 96, "test3: did not cover all 12 tickets on every rung");
    return _cat(
      _cat("TEST 3 rtp: PASS (", _toString(checks)),
      " ticket/wager checks, payout == floor(wager*96*D/(100*NUM)) exactly)"
    );
  }

  // ------------------------------------------------------------------- test 4

  /// @dev Every hook that returns or reserves a payout must agree to the base unit with
  ///      `payoutFor`, across tiny and very large wagers — the facet's cap has no slack.
  function _test4SinglePayoutFunction() internal view returns (string memory) {
    uint256[8] memory wagers = _wagerLadder();
    uint256 checks;
    for (uint8 ticket = 0; ticket <= 1; ticket++) {
      uint256[6] memory numerators = game.probabilityNumerators(ticket);
      for (uint256 w = 0; w < wagers.length; w++) {
        for (uint8 candle = 0; candle < CANDLE_COUNT; candle++) {
          checks += _checkOneTicket(wagers[w], candle, ticket, numerators[candle]);
        }
      }
    }
    _assert(checks == 96, "test4: did not cover all 12 tickets on every rung");
    return _cat(
      _cat("TEST 4 single-payout-function: PASS (", _toString(checks)),
      " ticket/wager combos x 3 words: quoteCaps, quoteRiskParams, onSessionStart and onRandomness agree)"
    );
  }

  function _checkOneTicket(
    uint256 wager,
    uint8 candle,
    uint8 ticket,
    uint256 numerator
  ) internal view returns (uint256) {
    bytes memory gameData = abi.encode(candle, ticket);
    uint256 worstCase = game.payoutFor(wager, candle, ticket, true);

    (uint256 maxEscrowStake, uint256 maxReservedProfit) = game.quoteCaps(wager, gameData);
    (uint256 riskMaxPayout, uint256 probabilityWad, , uint256 bodyVariance) = game.quoteRiskParams(
      wager,
      gameData
    );

    _assert(maxEscrowStake == wager, "test4: quoteCaps.maxEscrowStake != wager");
    _assert(riskMaxPayout == worstCase, "test4: quoteRiskParams.maxPayout != payoutFor");
    _assert(
      maxReservedProfit == (worstCase > wager ? worstCase - wager : 0),
      "test4: quoteCaps.maxReservedProfit != worstCase - wager"
    );
    _assert(bodyVariance == 0, "test4: body variance must be 0 for a single-tier bet");
    _assert(
      probabilityWad == (numerator * 1e18) / D,
      "test4: probabilityWad != NUM/D in WAD"
    );

    StepResult memory start = game.onSessionStart(_ctx(wager, gameData, ""));
    _assert(
      start.reservedProfitDelta == int256(maxReservedProfit),
      "test4: onSessionStart reserve != quoteCaps.maxReservedProfit"
    );
    _assert(start.escrowDelta == 0, "test4: onSessionStart escrowDelta != 0");
    _assert(start.payout == 0, "test4: onSessionStart payout != 0");
    _assert(
      start.nextPhase == SessionPhase.WAITING_RANDOMNESS && start.requestRandomnessNow,
      "test4: onSessionStart did not request randomness"
    );

    for (uint256 s = 0; s < 3; s++) {
      bytes32 word = keccak256(abi.encode("vigil", wager, candle, ticket, s));
      uint8[6] memory order = game.deriveOrder(word);
      bool won = ticket == 0
        ? order[5] == candle
        : (order[3] == candle || order[4] == candle || order[5] == candle);

      StepResult memory settled = game.onRandomness(_ctx(wager, gameData, ""), word);
      _assert(
        settled.payout == game.payoutFor(wager, candle, ticket, won),
        "test4: onRandomness payout != payoutFor"
      );
      _assert(settled.escrowDelta == 0, "test4: settling escrowDelta != 0");
      _assert(
        settled.reservedProfitDelta == 0,
        "test4: settling reservedProfitDelta != 0 (shrinks the cap)"
      );
      _assert(settled.nextPhase == SessionPhase.SETTLED, "test4: nextPhase != SETTLED");
      _assert(!settled.requestRandomnessNow, "test4: settling requested randomness");
      _assert(
        settled.payout <= wager + maxReservedProfit,
        "test4: payout exceeds the zero-slack facet cap"
      );

      (, uint8 gCandle, uint8 gTicket, bool gWon, uint256 gPayout) = abi.decode(
        settled.newGameState,
        (uint8[6], uint8, uint8, bool, uint256)
      );
      _assert(gCandle == candle && gTicket == ticket, "test4: gameState ticket mismatch");
      _assert(gWon == won, "test4: gameState won flag disagrees with the order");
      _assert(gPayout == settled.payout, "test4: gameState payout != StepResult.payout");
      _assert(gWon ? gPayout > 0 : gPayout == 0, "test4: won flag and payout disagree");
    }
    return 1;
  }

  // ------------------------------------------------------------------- test 5

  /// @dev Invalid candle/ticket and malformed gameData must revert on every entry point.
  function _test5Reverts() internal view returns (string memory) {
    uint256 wager = 1e18;
    uint256 checks;

    for (uint8 candle = 6; candle < 12; candle++) {
      bytes memory bad = abi.encode(candle, uint8(0));
      _assert(!_capsCall(wager, bad), "test5: quoteCaps accepted candle >= 6");
      _assert(!_startCall(wager, bad), "test5: onSessionStart accepted candle >= 6");
      _assert(!_randomnessCall(wager, bad), "test5: onRandomness accepted candle >= 6");
      checks += 3;
    }
    for (uint8 ticket = 2; ticket < 8; ticket++) {
      bytes memory bad = abi.encode(uint8(0), ticket);
      _assert(!_capsCall(wager, bad), "test5: quoteCaps accepted ticket > 1");
      _assert(!_startCall(wager, bad), "test5: onSessionStart accepted ticket > 1");
      _assert(!_randomnessCall(wager, bad), "test5: onRandomness accepted ticket > 1");
      checks += 3;
    }
    _assert(!_capsCall(wager, ""), "test5: quoteCaps accepted empty gameData");
    _assert(!_capsCall(wager, abi.encode(uint8(0))), "test5: quoteCaps accepted 32-byte gameData");
    _assert(
      !_capsCall(wager, abi.encode(uint8(0), uint8(0), uint8(0))),
      "test5: quoteCaps accepted 96-byte gameData"
    );
    _assert(!_randomnessCall(wager, ""), "test5: onRandomness accepted empty gameData");
    _assert(
      !_onPlayerActionCall(abi.encode(uint8(5), uint8(1))),
      "test5: onPlayerAction did not revert"
    );
    _assert(
      !_capsCall(wager, abi.encode(uint8(255), uint8(255))),
      "test5: quoteCaps accepted 255/255"
    );
    checks += 6;

    // Valid boundary values must NOT revert.
    _assert(_capsCall(wager, abi.encode(uint8(5), uint8(1))), "test5: quoteCaps rejected (5,1)");
    _assert(_capsCall(wager, abi.encode(uint8(0), uint8(0))), "test5: quoteCaps rejected (0,0)");
    checks += 2;

    return _cat(
      _cat("TEST 5 reverts: PASS (", _toString(checks)),
      " checks: candle 6..11, ticket 2..7, gameData 0/32/96 bytes, onPlayerAction reverts, (5,1)/(0,0) accepted)"
    );
  }

  // ------------------------------------------------------------------ test 5b

  /// @dev The sampler must always return a permutation on any word (no repeats, no aliasing),
  ///      including the all-ones and all-zero words.
  function _test5bSamplerWellformed() internal view returns (string memory) {
    uint256 words = 64;
    for (uint256 i = 0; i < words; i++) {
      bytes32 word = i == 0
        ? bytes32(type(uint256).max)
        : (i == 1 ? bytes32(0) : keccak256(abi.encode("vigil-order", i)));
      uint8[6] memory order = game.deriveOrder(word);
      uint256 seen;
      for (uint256 k = 0; k < 6; k++) {
        _assert(order[k] < CANDLE_COUNT, "test5b: order contains a candle >= 6");
        _assert(seen & (uint256(1) << order[k]) == 0, "test5b: order repeats a candle");
        seen |= uint256(1) << order[k];
      }
      _assert(seen == 0x3F, "test5b: order is not a full permutation of the six candles");
    }
    return _cat(
      _cat("TEST 5b sampler-wellformed: PASS (", _toString(words)),
      " words incl. all-1s and all-0s decode to valid permutations)"
    );
  }

  // ---------------------------------------------------------------- call probes

  function _capsCall(uint256 wager, bytes memory gameData) internal view returns (bool) {
    try game.quoteCaps(wager, gameData) returns (uint256, uint256) {
      return true;
    } catch {
      return false;
    }
  }

  function _startCall(uint256 wager, bytes memory gameData) internal view returns (bool) {
    try game.onSessionStart(_ctx(wager, gameData, "")) returns (StepResult memory) {
      return true;
    } catch {
      return false;
    }
  }

  function _randomnessCall(uint256 wager, bytes memory gameData) internal view returns (bool) {
    try game.onRandomness(_ctx(wager, gameData, ""), keccak256("vigil")) returns (
      StepResult memory
    ) {
      return true;
    } catch {
      return false;
    }
  }

  function _onPlayerActionCall(bytes memory gameData) internal view returns (bool) {
    try game.onPlayerAction(_ctx(1e18, gameData, ""), "") returns (StepResult memory) {
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------- helpers

  function _ctx(
    uint256 wager,
    bytes memory gameData,
    bytes memory gameState
  ) internal pure returns (SessionContext memory ctx) {
    ctx.player = address(0xBEEF);
    ctx.vault = address(0xCAFE);
    ctx.wagerBase = wager;
    ctx.escrowedStake = wager;
    ctx.gameData = gameData;
    ctx.gameState = gameState;
  }

  function _weights() internal pure returns (uint256[6] memory weights) {
    for (uint8 c = 0; c < CANDLE_COUNT; c++) weights[c] = uint256(c) + 1;
  }

  function _wagerLadder() internal pure returns (uint256[8] memory wagers) {
    wagers[0] = 1; // one base unit
    wagers[1] = 3;
    wagers[2] = 96;
    wagers[3] = 1000;
    wagers[4] = 12345678901234567;
    wagers[5] = 1e18; // 1 chUSD
    wagers[6] = 1e24;
    wagers[7] = 1e36; // far above any real bet; still no overflow
  }

  function _maskWeight(uint256 mask) internal pure returns (uint256 total) {
    for (uint8 c = 0; c < CANDLE_COUNT; c++) {
      if (mask & (uint256(1) << c) != 0) total += uint256(c) + 1;
    }
  }

  function _numerator(uint8 ticket, uint8 candle) internal view returns (uint256) {
    return game.probabilityNumerators(ticket)[candle];
  }

  function _assert(bool condition, string memory what) internal pure {
    if (!condition) revert TestFailed(what);
  }

  function _cat(string memory a, string memory b) internal pure returns (string memory) {
    return string(abi.encodePacked(a, b));
  }

  function _toString(uint256 value) internal pure returns (string memory) {
    if (value == 0) return "0";
    uint256 temp = value;
    uint256 digits;
    while (temp != 0) {
      digits++;
      temp /= 10;
    }
    bytes memory buffer = new bytes(digits);
    while (value != 0) {
      digits -= 1;
      buffer[digits] = bytes1(uint8(48 + (value % 10)));
      value /= 10;
    }
    return string(buffer);
  }
}
#!/usr/bin/env python3
"""
VIGIL reference math. Run: python3 vigil_math.py

Six candles. Death weights d = [1,2,3,4,5,6]. At every step the next candle to
die is drawn from the candles still lit with probability proportional to its
death weight (Plackett-Luce). That is exactly the death order of six
independent exponential clocks, so the "sequential draw" contract and the
"who outlasts whom" story are the same object.

Two tickets per candle:
  LAST  - my candle is the last one lit
  FINAL3 - my candle is among the last three lit (survives 3 deaths)

Every ticket pays  wager * RTP / P(win)  on a win, so RTP is exactly 96% for
all 12 tickets. The script prints the constants the contract and the client
mirror must use, and asserts the invariants the test suite must re-check.
"""
from fractions import Fraction as F
from itertools import permutations, combinations
from math import gcd
from functools import reduce

D_WEIGHTS = [1, 2, 3, 4, 5, 6]
N = len(D_WEIGHTS)
RTP = F(96, 100)


def order_prob(order):
    remaining = set(range(N))
    p = F(1)
    for c in order:
        p *= F(D_WEIGHTS[c], sum(D_WEIGHTS[j] for j in remaining))
        remaining.remove(c)
    return p


def main():
    probs = {o: order_prob(o) for o in permutations(range(N))}  # o[0] dies first
    assert sum(probs.values()) == 1

    last = [F(0)] * N
    final3 = [F(0)] * N
    first = [F(0)] * N
    for o, p in probs.items():
        first[o[0]] += p
        last[o[-1]] += p
        for c in o[3:]:
            final3[c] += p

    # closed-form cross-check for P(candle i is last lit)
    for i in range(N):
        others = [j for j in range(N) if j != i]
        s = F(0)
        for k in range(len(others) + 1):
            for S in combinations(others, k):
                s += (-1) ** k * F(D_WEIGHTS[i], D_WEIGHTS[i] + sum(D_WEIGHTS[j] for j in S))
        assert s == last[i]

    D = reduce(lambda a, b: a * b // gcd(a, b), (p.denominator for p in probs.values()))
    last_num = [int(p * D) for p in last]
    final3_num = [int(p * D) for p in final3]
    assert all(F(x, D) == p for x, p in zip(last_num, last))
    assert all(F(x, D) == p for x, p in zip(final3_num, final3))
    assert sum(last_num) == D and sum(final3_num) == 3 * D

    print(f"D (common denominator of all 720 order probabilities) = {D}")
    print(f"LAST_NUM   = {last_num}")
    print(f"FINAL3_NUM = {final3_num}")
    print()
    print("candle  d   P(last)   pays     P(final3)  pays")
    for i in range(N):
        print(
            f"  {i}     {D_WEIGHTS[i]}   {float(last[i]):.4f}  {float(RTP / last[i]):6.2f}x   "
            f"{float(final3[i]):.4f}   {float(RTP / final3[i]):5.2f}x"
        )
    print()
    print(f"max multiplier: LAST {float(RTP * D / min(last_num)):.4f}x, FINAL3 {float(RTP * D / min(final3_num)):.4f}x")


if __name__ == "__main__":
    main()

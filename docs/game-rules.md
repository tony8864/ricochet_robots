# Competitive Ricochet Robots — draft rules

Status: initial robot and wall scope agreed; remaining decisions require review before their implementation.

## Published rules

Source: [Rio Grande Games, Ricochet Robots rulebook](https://www.riograndegames.com/wp-content/uploads/2013/02/RicochetRobots.pdf), Alex Randolph, ©2013 ABACUSSPIELE, pp. 1–2. This edition includes diagonal barriers and a black-robot variant.

- Assemble four differently marked quadrants around the center. Four colored robots start off targets. Seventeen targets comprise sixteen colored symbols and a multicolored vortex.
- Reveal a target: its matching robot must reach it; any robot qualifies for the vortex. Helpers may move.
- Robots slide orthogonally until blocked by walls, edges, center, or robots. Each slide costs one move, including helpers. The target robot must turn 90° at least once en route.
- Diagonal barriers pass matching colors and redirect others 90° within one move; stopping there is illegal. The optional black robot can help or solve the vortex.
- Search mentally. First bid starts roughly one minute; others may bid higher, equal, or lower. Own bids cannot increase.
- After countdown, demonstrate the lowest bid, earliest first; success requires exactly that count. Failure resets positions; remaining bidders try in ascending count, then submission order.
- Success awards one chip; resulting positions begin the next round. All failures return the chip to the shuffled pool.
- End at 8/6/5 chips for 2/3/4 players; with more, exhaust chips. Most chips wins; tied winners share victory. Agreed alternatives are allowed.

## Our online adaptation — established requirements

- Initial scope uses five robots: red, green, blue, yellow, and black, adopting the published black-robot variant. Black can act as a blocker and solve the multicolored vortex; colored targets require their matching robot.
- Use ordinary walls only, with no diagonal barriers. Every robot moves horizontally or vertically; diagonal movement is never allowed.
- Players independently simulate moves on identical local boards, replacing mental-only search. Local exploration does not change another player's board or the authoritative round start.
- Client and server share a Swing- and networking-independent engine.
- The server owns rooms, join codes, target selection, round state, timers, bid ordering, scores, and validation of submitted robot/direction sequences against the authoritative starting state.
- Validation must account for every robot's moves, legal stopping positions, target eligibility, the required turn, and the declared count. A successful demonstration's resulting positions become the next authoritative start, following the published rule.

## Already-occupied targets

Only the currently revealed target matters. Standing on another target does not score. A zero-move solution cannot satisfy the published requirement for the solving robot to turn 90° on its route.

The rulebook does not explicitly prescribe what to do when the eligible robot already occupies the revealed target. **Proposed adaptation, awaiting review:** keep the target active and require that robot to leave and return through a legal route containing the required turn. Do not silently replace the target or award a point.

## Decisions requiring review

The rulebook does not settle these online policies; none is selected here:

- **Board setup:** how are boards and initial positions generated and distributed?
- **Timing and ordering:** exact countdown duration, server receipt versus client timestamps, simultaneous bids, latency allowance, and deadline boundary behavior. Does improving a bid establish a new priority timestamp?
- **Submission and demonstration:** commit a sequence with the bid or supply it afterward? Allow editing after countdown? Set a demonstration deadline? Show a replay, and when may other players see solutions?
- **Validation edge cases:** reject or ignore commands producing no movement? How is the required turn tracked when helpers intervene? Confirm the proposed already-occupied-target policy above, including eligibility for the vortex.
- **Failure and absence:** treatment of missing/late/invalid submissions, disconnects, reconnection, and whether a player gets another attempt after failure.
- **Unsolved rounds:** automate the rulebook's optional no-bid fallback (roughly 4–5 minutes, then one final minute), choose exact durations, or adopt another policy? Define reset and reshuffle behavior.
- **Match lifecycle:** player limits, late joins, departures changing player count, end thresholds, and whether to preserve shared victories or introduce a tiebreaker.

No engine behavior should be inferred from these open questions until reviewed.

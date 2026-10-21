import { assertValidGameState } from '@robot-puzzle/game-engine';
import { MAX_STORED_STATES } from '../solver';
import { validateCatalog } from '../validation';
import type { RoundSetupBudget, RoundSetupInput } from './types';

function validateBudget(budget: RoundSetupBudget): void {
  const perCandidate = budget?.perCandidate;
  if (
    !perCandidate ||
    !Number.isSafeInteger(perCandidate.maxExpandedStates) || perCandidate.maxExpandedStates < 0 ||
    !Number.isSafeInteger(perCandidate.maxStoredStates) || perCandidate.maxStoredStates < 1 ||
    perCandidate.maxStoredStates > MAX_STORED_STATES ||
    !Number.isSafeInteger(budget.maxTotalExpandedStates) || budget.maxTotalExpandedStates < 0
  ) {
    throw new RangeError(
      'Invalid round setup budget: expansion limits must be nonnegative safe integers; ' +
      `maxStoredStates must be an integer from 1 to ${MAX_STORED_STATES}.`,
    );
  }
}

function validateIds(value: readonly string[], path: string, validIds: ReadonlySet<string>): void {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array of target IDs.`);
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || !validIds.has(id)) throw new TypeError(`${path} contains an unknown target ID: ${String(id)}.`);
    if (seen.has(id)) throw new TypeError(`${path} contains duplicate target ID "${id}".`);
    seen.add(id);
  }
}

export function validateRoundSetupInput(input: RoundSetupInput): void {
  if (typeof input !== 'object' || input === null) throw new TypeError('Expected a round setup input object.');
  const catalog = validateCatalog([input.puzzle]);
  if (!catalog.valid) {
    throw new TypeError('Invalid round setup board: ' + catalog.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  assertValidGameState({ board: input.puzzle.board, robots: input.robots, target: input.puzzle.targets[0] });
  const ids = new Set(input.puzzle.targets.map((target) => target.id));
  validateIds(input.usedTargetIds, 'usedTargetIds', ids);
  validateIds(input.candidateOrder, 'candidateOrder', ids);
  if (input.candidateOrder.length !== ids.size) throw new TypeError('candidateOrder must contain every board target exactly once.');
  validateBudget(input.budget);
}

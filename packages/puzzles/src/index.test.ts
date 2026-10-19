import { expect, test } from 'vitest';
import * as puzzles from './index';

test('the puzzles entry point imports without runtime-specific globals', () => {
  expect(Object.keys(puzzles)).toEqual([]);
});

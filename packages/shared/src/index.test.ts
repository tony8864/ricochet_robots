import { expect, test } from 'vitest';
import * as shared from './index';

test('the shared entry point imports without runtime-specific globals', () => {
  expect(Object.keys(shared)).toEqual([]);
});

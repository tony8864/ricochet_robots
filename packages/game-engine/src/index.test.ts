import { expect, test } from 'vitest';
import * as engine from './index';

test('the engine entry point imports without a browser runtime', () => {
  expect(Object.keys(engine)).toEqual([]);
});

import { expect, test } from 'vitest';
import * as server from './index';

test('the server entry point imports without browser or Cloudflare globals', () => {
  expect(Object.keys(server)).toEqual([]);
});

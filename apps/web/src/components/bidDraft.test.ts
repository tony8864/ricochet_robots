import { expect, test } from 'vitest';
import { bidDraftReducer, canPlaceBid, INITIAL_BID_DRAFT, parseBidDraft } from './bidDraft';

test('draft starts at one and step buttons increment/decrement without dropping below one', () => {
  expect(INITIAL_BID_DRAFT.text).toBe('1');
  expect(bidDraftReducer(INITIAL_BID_DRAFT, { type: 'step', delta: -1 })).toBe(INITIAL_BID_DRAFT);
  const two = bidDraftReducer(INITIAL_BID_DRAFT, { type: 'step', delta: 1 });
  expect(two).toEqual({ text: '2', lastValidValue: 2 });
  expect(bidDraftReducer(two, { type: 'step', delta: -1 })).toEqual(INITIAL_BID_DRAFT);
});

test.each(['1', '7', '125', String(Number.MAX_SAFE_INTEGER)])('accepts direct positive-integer entry %s', (text) => {
  expect(bidDraftReducer(INITIAL_BID_DRAFT, { type: 'edit', text })).toEqual({ text, lastValidValue: Number(text) });
});

test.each(['-1', '1.5', '1e2', 'abc', ' 2', '+3'])('ignores non-digit edit %s', (text) => {
  expect(bidDraftReducer(INITIAL_BID_DRAFT, { type: 'edit', text })).toBe(INITIAL_BID_DRAFT);
  expect(parseBidDraft(text)).toBeNull();
});

test.each(['', '0', '9007199254740992'])('invalid temporary draft %j cannot step and restores its last valid value on blur', (text) => {
  const seven = bidDraftReducer(INITIAL_BID_DRAFT, { type: 'edit', text: '7' });
  const invalid = bidDraftReducer(seven, { type: 'edit', text });
  expect(invalid.text).toBe(text);
  expect(parseBidDraft(text)).toBeNull();
  expect(bidDraftReducer(invalid, { type: 'step', delta: 1 })).toBe(invalid);
  expect(bidDraftReducer(invalid, { type: 'step', delta: -1 })).toBe(invalid);
  expect(bidDraftReducer(invalid, { type: 'blur' })).toEqual(seven);
});

test('empty entry can be replaced directly and valid leading zeroes normalize on blur', () => {
  const cleared = bidDraftReducer(INITIAL_BID_DRAFT, { type: 'edit', text: '' });
  const edited = bidDraftReducer(cleared, { type: 'edit', text: '0042' });
  expect(edited).toEqual({ text: '0042', lastValidValue: 42 });
  expect(bidDraftReducer(edited, { type: 'blur' })).toEqual({ text: '42', lastValidValue: 42 });
});

test('safe integer boundary is respected without an arbitrary smaller cap', () => {
  const maximum = bidDraftReducer(INITIAL_BID_DRAFT, { type: 'edit', text: String(Number.MAX_SAFE_INTEGER) });
  expect(bidDraftReducer(maximum, { type: 'step', delta: 1 })).toBe(maximum);
  expect(bidDraftReducer(maximum, { type: 'step', delta: -1 }).text).toBe(String(Number.MAX_SAFE_INTEGER - 1));
});

test('draft edits are immutable and independent of the shared initial value', () => {
  const original = Object.freeze({ ...INITIAL_BID_DRAFT });
  const changed = bidDraftReducer(original, { type: 'edit', text: '15' });
  expect(original.text).toBe('1');
  expect(changed.text).toBe('15');
  expect(INITIAL_BID_DRAFT).toEqual({ text: '1', lastValidValue: 1 });
});

test('submission permits new bids regardless of competitors, but only own reductions after acceptance', () => {
  expect(canPlaceBid('1')).toBe(true);
  expect(canPlaceBid('12')).toBe(true);
  expect(canPlaceBid('5', 7)).toBe(true);
  expect(canPlaceBid('7', 7)).toBe(false);
  expect(canPlaceBid('8', 7)).toBe(false);
  expect(canPlaceBid('1', 1)).toBe(false);
  for (const text of ['', '0', '-1', '2.5', '9007199254740992']) expect(canPlaceBid(text)).toBe(false);
});

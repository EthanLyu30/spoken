import { expect, it } from 'vitest';
import { referenceCost } from './adminFormatting';

it('distinguishes unknown cost, genuine zero, small positive cost and a range', () => {
  expect(referenceCost(null, null)).toBe('—');
  expect(referenceCost(undefined, 1)).toBe('—');
  expect(referenceCost(0, 0)).toBe('¥0');
  expect(referenceCost(.000001, .000002)).toBe('¥<0.0001');
  expect(referenceCost(.002, .006)).toBe('¥0.0020–0.0060');
});

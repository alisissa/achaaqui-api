import { describe, expect, it } from 'vitest';
import { combineRatings } from '../src/reviews/reviews.service';

describe('combineRatings', () => {
  it('should combine product and merchant reputation equally', () => {
    expect(combineRatings(4.7, 3.1)).toBe(3.9);
  });

  it('should suppress a buying score until both sides have reviews', () => {
    expect(combineRatings(4.25, null)).toBeNull();
    expect(combineRatings(null, 3.8)).toBeNull();
  });

  it('should return null when neither reputation has reviews', () => {
    expect(combineRatings(null, null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { assertAcceptableComment } from '../src/reviews/comment-filter';

describe('bounded PT/EN comment filter', () => {
  it.each([
    null,
    undefined,
    '',
    'Produto ruim, não recomendo. Não gostei!',
    'Terrible battery. Waste of money. It stopped working after one day.',
    'Computador excelente. Vou te recomendar este produto.',
    'Classic headphones from Scunthorpe. Assembly is poor.',
    'The game lets you kill enemies. A porta está quebrada!',
    "It's hit or miss",
    "that's hit the spot",
    "It's\thit or miss",
    "that's\nhit the spot",
  ])('allows normal feedback: %s', (comment) => {
    expect(() => assertAcceptableComment(comment)).not.toThrow();
  });
  it.each([
    'FUCK!',
    'f.u.c.k',
    'm3rda',
    'f\u200Buck',
    'ｆｕｃｋ',
    'sh!t',
    'bullsh1t',
    'CARALHO',
    'p0rr4',
    'Que mérda!',
    'You asshole.',
    'I will kill you.',
    'I am going to rape you',
    'kill yourself',
    'Vou te matar',
    'Vou matar você',
    'se mate',
  ])('rejects clear abuse: %s', (comment) => {
    expect(() => assertAcceptableComment(comment)).toThrow(
      'Please remove abusive language',
    );
    try {
      assertAcceptableComment(comment);
    } catch (error) {
      expect((error as { getStatus(): number }).getStatus()).toBe(422);
    }
  });

  it('does not join fully spaced-out letters, avoiding cross-word false positives', () => {
    for (const comment of ['f u c k', 'p u t a']) {
      expect(() => assertAcceptableComment(comment)).not.toThrow();
    }
  });
});

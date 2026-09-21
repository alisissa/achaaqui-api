import { UnprocessableEntityException } from '@nestjs/common';

// Deliberately small, deterministic PT/EN baseline. This is not semantic
// moderation: reports and human follow-up remain necessary. Match whole words
// (including simple punctuation obfuscation), never substrings of product names.
const words = [
  'fuck',
  'fucking',
  'fucker',
  'motherfucker',
  'shit',
  'bullshit',
  'bitch',
  'asshole',
  'cunt',
  'caralho',
  'porra',
  'merda',
  'puta',
  'puto',
];
const wordPatterns = words.map(
  // Never join separate words: "it's hit" must not become "shit".
  (word) => new RegExp(`\\b${[...word].join('[.\\-_*]*')}\\b`, 'u'),
);
const threats = [
  /\b(?:i will|i am going to|im going to) (?:kill|rape) you\b/u,
  /\b(?:kill yourself|go die|vou (?:te (?:matar|estuprar)|matar voce|estuprar voce)|se mate)\b/u,
];

export function assertAcceptableComment(
  comment: string | null | undefined,
): void {
  if (!comment) return;
  const normalized = comment
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(/(?<=[a-z])!(?=[a-z])/g, 'i')
    .replace(
      /[013457@$]/g,
      (character) =>
        ({
          '0': 'o',
          '1': 'i',
          '3': 'e',
          '4': 'a',
          '5': 's',
          '7': 't',
          '@': 'a',
          $: 's',
        })[character] ?? character,
    );
  // Keep punctuation between letters for word matching; collapse it for phrases.
  const phrase = normalized.replace(/[^a-z0-9]+/g, ' ').trim();
  if (
    wordPatterns.some((pattern) => pattern.test(normalized)) ||
    threats.some((pattern) => pattern.test(phrase))
  ) {
    throw new UnprocessableEntityException(
      'Please remove abusive language or threats from your comment and try again.',
    );
  }
}

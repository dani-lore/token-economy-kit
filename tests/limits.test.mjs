// Tests for hooks/limits.mjs pricing helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputPrice } from '../hooks/limits.mjs';

test('inputPrice matches the model family, case-insensitive', () => {
  assert.equal(inputPrice('claude-haiku-5-5'), 0.10);
  assert.equal(inputPrice('claude-sonnet-5-5'), 2);
  assert.equal(inputPrice('claude-opus-5-5'), 4);
  assert.equal(inputPrice('CLAUDE-OPUS-4-1[1m]'), 4);
  assert.equal(inputPrice('haiku'), 0.10);
});

test('inputPrice is null for unknown or missing models', () => {
  for (const id of ['claude-fable-5', 'gpt-5', '', undefined, null]) assert.equal(inputPrice(id), null);
});

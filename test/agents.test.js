import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgents } from '../src/bot/utils/agents.js';
import { isValidEmoji, toComponentEmoji } from '../src/bot/utils/emoji.js';

test('parseAgents mélange mentions et matricules', () => {
  const r = parseAgents('<@123456789012345678> <@!223456789012345678>, 1234, B-12');
  assert.deepEqual(r.ids, ['123456789012345678', '223456789012345678']);
  assert.deepEqual(r.labels, ['<@123456789012345678>', '<@223456789012345678>', '1234', 'B-12']);
  assert.deepEqual(parseAgents('1234 5678').labels, ['1234', '5678']);
});

test('validation des emojis', () => {
  assert.ok(isValidEmoji('🏪'));
  assert.ok(isValidEmoji('⛽'));
  assert.ok(isValidEmoji('👮‍♂️'));
  assert.ok(isValidEmoji('<:bobcat:123456789012345678>'));
  assert.ok(!isValidEmoji('abc'));
  assert.deepEqual(toComponentEmoji('<a:x_y:123456789012345678>'), { id: '123456789012345678', name: 'x_y', animated: true });
  assert.deepEqual(toComponentEmoji('🏪'), { name: '🏪' });
});

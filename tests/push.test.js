import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyToBytes } from '../js/push.js';

test('keyToBytes decodes url-safe base64 without padding', () => {
  assert.deepEqual([...keyToBytes('-_8')], [251, 255]);
  assert.deepEqual([...keyToBytes('AQID')], [1, 2, 3]);
});

test('keyToBytes gives the 65 bytes of a public sending key', () => {
  const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
  const bytes = keyToBytes(key);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
});

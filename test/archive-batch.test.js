'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { archiveBatch } = require('../archive-batch');

test('large archive batches cap concurrent writes and retain individual failures', async () => {
  let active = 0;
  let peak = 0;
  const ids = Array.from({ length: 92 }, (_, index) => `thread-${index}`);
  const result = await archiveBatch(ids, async (id) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    if (id === 'thread-91') throw new Error('already has an active writer');
  });

  assert.equal(peak, 4);
  assert.equal(result.archived.length, 91);
  assert.deepEqual(result.failed, [{ id: 'thread-91', message: 'already has an active writer' }]);
  assert.equal(new Set([...result.archived, ...result.failed.map((item) => item.id)]).size, 92);
});

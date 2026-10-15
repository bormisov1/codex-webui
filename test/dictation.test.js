'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserProvider } = require('../public/dictation.js');

class FakeRecognition {
  static instances = [];

  constructor() { FakeRecognition.instances.push(this); }
  start() { this.onstart?.(); }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; this.onend?.(); }
  result(results) { this.onresult?.({ results }); }
  end() { this.onend?.(); }
}

function result(transcript, isFinal) {
  return Object.assign([{ transcript }], { isFinal });
}

test('browser provider waits for final words before completing stop', async () => {
  FakeRecognition.instances = [];
  const states = [];
  const final = [];
  const interim = [];
  const provider = createBrowserProvider({
    onState: (value) => states.push(value),
    onFinal: (value) => final.push(value),
    onInterim: (value) => interim.push(value),
  }, FakeRecognition);

  assert.equal(provider.supported, true);
  assert.equal(provider.start({ language: 'ru-RU' }), true);
  const recognition = FakeRecognition.instances[0];
  assert.equal(recognition.lang, 'ru-RU');
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);
  assert.equal(provider.start(), false);

  recognition.result([result('first', true), result('sec', false)]);
  recognition.result([result('first', true), result('second', true)]);
  recognition.result([result('first', true), result('second', true)]);
  assert.deepEqual(final, ['first', 'second']);
  assert.deepEqual(interim, ['sec', '', '']);

  const finished = provider.stop();
  let settled = false;
  finished.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(provider.stop(), finished);
  recognition.result([result('first', true), result('second', true), result('last', true)]);
  recognition.end();
  assert.equal(await finished, 'ended');
  assert.deepEqual(final, ['first', 'second', 'last']);
  assert.equal(provider.isActive(), false);
  assert.deepEqual(states, ['starting', 'listening', 'stopping', 'idle']);
});

test('cancel ends a pending send and ignores late results after switching threads', async () => {
  FakeRecognition.instances = [];
  const final = [];
  const provider = createBrowserProvider({ onFinal: (value) => final.push(value) }, FakeRecognition);
  provider.start();
  const oldRecognition = FakeRecognition.instances[0];
  const finished = provider.stop();
  provider.cancel();
  assert.equal(await finished, 'cancelled');
  oldRecognition.result([result('wrong thread', true)]);
  assert.deepEqual(final, []);
  assert.equal(oldRecognition.aborted, true);

  provider.start();
  FakeRecognition.instances[1].result([result('new thread', true)]);
  assert.deepEqual(final, ['new thread']);
});

test('unsupported browsers cannot start dictation', () => {
  const provider = createBrowserProvider({}, null);
  assert.equal(provider.supported, false);
  assert.throws(() => provider.start(), /unavailable in this browser/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function functionBlock(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Could not find ${start}`);
  return app.slice(from, to);
}

function harness() {
  const sent = [];
  let interruptClicks = 0;
  const state = {
    threadId: 'thread-1', turnId: 'turn-1', running: true,
    messageQueue: [], queueSending: false, queueFailedId: null,
    interruptingTurnId: null, attachments: [], stagedMessage: null,
  };
  const context = vm.createContext({
    state,
    QUEUE_KEY: 'test-queue',
    sent,
    localStorage: { setItem() {} },
    crypto: { randomUUID: () => `queued-${state.messageQueue.length + sent.length + 1}` },
    $: (selector) => selector === '#message-queue' ? null : {
      classList: { add() {} }, click() { interruptClicks++; },
    },
    clearAttachments() { state.attachments = []; },
    renderAttachments() {},
    saveDraft() {},
  });
  vm.runInContext(`${functionBlock('  function saveMessageQueue()', '  function workspaceSystemPrompt()')}
    ${functionBlock('  async function sendMessage(text,', '  function summarizeApproval(')}
    this.queueApi = { enqueueStaged, flushMessageQueue, sendMessage };`, context);
  function mockTransport() {
    vm.runInContext(`sendMessage = async (text) => {
      sent.push(text);
      state.running = true;
      return true;
    };`, context);
  }
  return { state, sent, api: context.queueApi, mockTransport, get interruptClicks() { return interruptClicks; } };
}

async function drainInOrder(harness, expected) {
  harness.mockTransport();
  for (const text of expected) {
    harness.state.running = false;
    await harness.api.flushMessageQueue();
    assert.equal(harness.sent.at(-1), text);
  }
  assert.deepEqual(harness.sent, expected);
  assert.equal(harness.state.messageQueue.length, 0);
}

test('an interrupt sends an earlier queued message before the interrupting message', async () => {
  const h = harness();
  h.state.stagedMessage = { text: 'first', attachments: [] };
  h.api.enqueueStaged();
  h.state.stagedMessage = { text: 'second', attachments: [] };
  h.api.enqueueStaged({ interrupt: true });
  assert.equal(h.interruptClicks, 1);
  assert.deepEqual(Array.from(h.state.messageQueue, (item) => item.text), ['first', 'second']);

  h.state.interruptingTurnId = 'turn-1';
  h.state.running = false;
  await h.api.flushMessageQueue();
  assert.equal(h.state.messageQueue.length, 2);
  h.state.interruptingTurnId = null;
  await drainInOrder(h, ['first', 'second']);
});

test('multiple queued messages stay ahead of a later interrupting message', async () => {
  const h = harness();
  for (const text of ['first', 'second', 'third']) {
    h.state.stagedMessage = { text, attachments: [] };
    h.api.enqueueStaged();
  }
  h.state.stagedMessage = { text: 'interrupting', attachments: [] };
  h.api.enqueueStaged({ interrupt: true });
  assert.equal(h.interruptClicks, 1);
  await drainInOrder(h, ['first', 'second', 'third', 'interrupting']);
});

test('a composer send during queue handoff joins the tail', async () => {
  const h = harness();
  h.state.stagedMessage = { text: 'first', attachments: [] };
  h.api.enqueueStaged();
  h.state.running = false;
  h.state.interruptingTurnId = 'turn-1';
  assert.equal(await h.api.sendMessage('second'), true);
  assert.deepEqual(Array.from(h.state.messageQueue, (item) => item.text), ['first', 'second']);
  h.state.interruptingTurnId = null;
  await drainInOrder(h, ['first', 'second']);
});

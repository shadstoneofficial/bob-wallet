import test from 'tape';

import { formatActionLog, makeServer, SIGIL } from '../ipc';

function nextTurn() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

test('packaged action logs describe IPC work without request or response data', async t => {
  let handler;
  const messages = [];
  const responses = [];
  const ipcMain = {
    on(channel, listener) {
      t.equal(channel, SIGIL);
      handler = listener;
    },
    removeListener() {},
  };
  const server = makeServer(ipcMain, () => true, message => messages.push(message));
  server.withMethod('Hip2', 'fetchAddress', async () => 'hs1privateaddress');
  server.start();

  handler({sender: {send: (...args) => responses.push(args)}}, {
    id: 1,
    method: 'Hip2.fetchAddress',
    params: ['@private.example'],
  });
  await nextTurn();

  t.equal(messages.length, 2);
  t.equal(messages[0], '[Bob action] Hip2.fetchAddress started');
  t.match(messages[1], /^\[Bob action\] Hip2\.fetchAddress succeeded \(\d+ ms\)$/);
  t.notOk(messages.join(' ').includes('private.example'), 'request data is not logged');
  t.notOk(messages.join(' ').includes('hs1privateaddress'), 'response data is not logged');
  t.equal(responses.length, 1, 'IPC response is still delivered');
  t.end();
});

test('packaged action failure logs expose only a bounded error code', async t => {
  let handler;
  const messages = [];
  const ipcMain = {
    on(channel, listener) {
      handler = listener;
    },
    removeListener() {},
  };
  const server = makeServer(ipcMain, () => true, message => messages.push(message));
  server.withMethod('Hip2', 'fetchAddress', async () => {
    const error = new Error('secret hostname private.example');
    error.code = 'ETLSAMISMATCH<script>';
    throw error;
  });
  server.start();

  handler({sender: {send() {}}}, {
    id: 2,
    method: 'Hip2.fetchAddress',
    params: ['@private.example'],
  });
  await nextTurn();

  t.match(
    messages[1],
    /^\[Bob action\] Hip2\.fetchAddress failed \[ETLSAMISMATCHscript\] \(\d+ ms\)$/,
  );
  t.notOk(messages.join(' ').includes('secret hostname'));
  t.notOk(messages.join(' ').includes('private.example'));
  t.end();
});

test('action log formatter clamps invalid duration values', t => {
  t.equal(
    formatActionLog('Wallet.send', 'succeeded', -12),
    '[Bob action] Wallet.send succeeded (0 ms)',
  );
  t.end();
});

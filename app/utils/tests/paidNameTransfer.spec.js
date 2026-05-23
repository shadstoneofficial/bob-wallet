import test from 'tape';
import {
  PAID_NAME_TRANSFER_TYPE,
  buildPaidNameTransferPayload,
  parsePaidNameTransferInput,
  stringifyPaidNameTransferPayload,
} from '../paidNameTransfer';

test('paid name transfer payload helper parses rich envelope', (t) => {
  const payload = buildPaidNameTransferPayload({
    txHex: '00ff',
    network: 'regtest',
    name: 'alice',
    buyerAddress: 'rs1buyer',
    sellerPaymentAddress: 'rs1seller',
    price: 123456000,
    transferTxHash: 'abcd',
    note: 'private sale',
  });

  const parsed = parsePaidNameTransferInput(stringifyPaidNameTransferPayload(payload));

  t.equal(payload.type, PAID_NAME_TRANSFER_TYPE);
  t.equal(payload.priceHNS, '123.456');
  t.equal(parsed.txHex, '00ff');
  t.equal(parsed.isEnvelope, true);
  t.equal(parsed.payload.name, 'alice');
  t.equal(parsed.payload.note, 'private sale');
  t.end();
});

test('paid name transfer payload helper keeps legacy tx JSON and raw hex compatible', (t) => {
  const legacy = parsePaidNameTransferInput(JSON.stringify({version: 1, tx: 'aabb'}));
  const raw = parsePaidNameTransferInput('ccdd');

  t.equal(legacy.txHex, 'aabb');
  t.equal(legacy.isEnvelope, false);
  t.equal(raw.txHex, 'ccdd');
  t.equal(raw.payload, null);
  t.end();
});


import { MTX } from 'hsd/lib/primitives';
import { Amount } from 'hsd/lib/ui';

export const PAID_NAME_TRANSFER_TYPE = 'bob-paid-name-transfer';
export const PAID_NAME_TRANSFER_VERSION = 1;
const COVENANT_TYPES = {
  NONE: 0,
  FINALIZE: 10,
};

export function parsePaidNameTransferInput(value) {
  const text = `${value || ''}`.trim();
  if (!text) {
    throw new Error('Enter a paid name transfer payload.');
  }

  try {
    const json = JSON.parse(text);
    const txHex = json.tx || json.txHex;
    if (!txHex || typeof txHex !== 'string') {
      throw new Error('No transaction found in payload.');
    }

    return {
      txHex,
      payload: json,
      isEnvelope: json.type === PAID_NAME_TRANSFER_TYPE,
    };
  } catch (e) {
    if (!/^[0-9a-fA-F]+$/.test(text)) {
      throw e;
    }

    return {
      txHex: text,
      payload: null,
      isEnvelope: false,
    };
  }
}

export function inspectPaidNameTransfer(txHex, network) {
  const mtx = MTX.decode(Buffer.from(txHex, 'hex'));
  const errors = [];
  const warnings = [];
  const firstOutput = mtx.outputs[0];
  const paymentOutput = mtx.outputs[1];
  const firstInput = mtx.inputs[0];

  if (!firstInput) {
    errors.push('Missing transfer input.');
  }

  if (!firstOutput) {
    errors.push('Missing name finalize output.');
  } else if (firstOutput.covenant.type !== COVENANT_TYPES.FINALIZE) {
    errors.push('First output is not a FINALIZE covenant.');
  }

  if (!paymentOutput) {
    errors.push('Missing seller payment output.');
  } else if (paymentOutput.covenant.type !== COVENANT_TYPES.NONE) {
    errors.push('Seller payment output must be a plain HNS output.');
  }

  let name = '';
  let nameReceiveAddr = '';
  let fundingAddr = '';
  let price = 0;

  try {
    name = firstOutput.covenant.items[2].toString('ascii');
  } catch (e) {
    errors.push('Could not read the domain name from the finalize output.');
  }

  try {
    nameReceiveAddr = firstOutput.address.toString(network);
  } catch (e) {
    errors.push('Could not read the domain receiving address.');
  }

  try {
    fundingAddr = paymentOutput.address.toString(network);
    price = paymentOutput.value;
  } catch (e) {
    errors.push('Could not read the seller payment output.');
  }

  const sellerSignature = firstInput && firstInput.witness && firstInput.witness.items && firstInput.witness.items[0];
  if (sellerSignature && sellerSignature.length) {
    const sighashType = sellerSignature[sellerSignature.length - 1];
    if (sighashType !== 0x84) {
      errors.push('Seller signature does not use paid-transfer sighash flags.');
    }
  } else {
    warnings.push('Seller signature could not be detected in the payload.');
  }

  return {
    mtx,
    errors,
    warnings,
    name,
    nameReceiveAddr,
    fundingAddr,
    price,
    priceHNS: Amount.fromValue(price).toCoins(),
  };
}

export function buildPaidNameTransferPayload({
  txHex,
  network,
  name,
  buyerAddress,
  sellerPaymentAddress,
  price,
  transferTxHash,
  note,
}) {
  const payload = {
    version: PAID_NAME_TRANSFER_VERSION,
    type: PAID_NAME_TRANSFER_TYPE,
    network,
    name,
    buyerAddress,
    sellerPaymentAddress,
    price,
    priceHNS: Amount.fromValue(price || 0).toCoins(),
    transferTxHash,
    createdAt: new Date().toISOString(),
    tx: txHex,
  };

  if (note) {
    payload.note = note;
  }

  return payload;
}

export function stringifyPaidNameTransferPayload(payload) {
  return JSON.stringify(payload, null, 2);
}

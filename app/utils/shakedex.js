// Extract from https://github.com/kurumiimari/shakedex-api/blob/9b6d111afad8b14b4ccf3af7eca4945c3d193bb6/src/service/auctions.js

import { LISTING_STATUS } from '../constants/exchange';

const jsonSchemaValidate = require('jsonschema').validate;

const hexRegex = (len = null) => {
  return new RegExp(`^[a-f0-9]${len ? `{${len}}` : '+'}$`);
};

const addressRegex = /^(hs|rs|ts|ss)1[a-zA-HJ-NP-Z0-9]{25,39}$/i;

export const fulfillmentSchema = {
  type: 'object',
  required: [
    'broadcastAt',
    'fulfillmentTxHash',
    'lockingPublicKey',
    'name',
    'price',
  ],
  properties: {
    name: {
      type: 'string',
    },
    lockingPublicKey: {
      type: 'string',
      pattern: hexRegex(66),
    },
    fulfillmentTxHash: {
      type: 'string',
      pattern: hexRegex(64),
    },
    price: {
      type: 'integer',
      minimum: 0,
    },
    broadcastAt: {
      type: 'integer',
      minimum: 0,
    },
  }
}

export const auctionSchema = {
  type: 'object',
  required: [
    'version',
    'name',
    'lockingTxHash',
    'lockingOutputIdx',
    'publicKey',
    'paymentAddr',
    'data',
  ],
  properties: {
    version: {
      type: 'integer',
      minimum: 2,
    },
    name: {
      type: 'string',
    },
    lockingTxHash: {
      type: 'string',
      pattern: hexRegex(64),
    },
    lockingOutputIdx: {
      type: 'integer',
      minimum: 0,
    },
    publicKey: {
      type: 'string',
      pattern: hexRegex(66),
    },
    paymentAddr: {
      type: 'string',
      pattern: addressRegex,
    },
    data: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: [
          'price',
          'lockTime',
          'signature',
        ],
        properties: {
          price: {
            type: 'integer',
            minimum: 0,
          },
          fee: {
            type: 'integer',
            minimum: 0,
          },
          lockTime: {
            type: 'integer',
            minimum: 1610000000,
          },
          signature: {
            type: 'string',
            pattern: hexRegex(130),
          },
        },
      },
    },
  },
};

export const paramSchema = {
  type: 'object',
  required: [
    'durationDays',
    'endPrice',
    'startPrice',
  ],
  properties: {
    durationDays: {
      type: 'integer',
      minimum: 0,
    },
    endPrice: {
      type: 'integer',
      minimum: 0,
    },
    startPrice: {
      type: 'integer',
      minimum: 0,
    },
  },
};

export const finalizeLockScheme = {
  type: 'object',
  required: [
    'broadcastAt',
    'encryptedPrivateKey',
    'finalizeOutputIdx',
    'finalizeTxHash',
    'name',
    'publicKey',
  ],
  properties: {
    broadcastAt: {
      type: 'integer',
    },
    encryptedPrivateKey: {
      type: 'string',
      pattern: hexRegex(160),
    },
    finalizeOutputIdx: {
      type: 'integer',
      minimum: 0,
    },
    finalizeTxHash: {
      type: 'string',
      pattern: hexRegex(64),
    },
    name: {
      type: 'string',
    },
    publicKey: {
      type: 'string',
      pattern: hexRegex(66),
    },
  },
};

export const nameLockSchema = {
  type: 'object',
  required: [
    'broadcastAt',
    'encryptedPrivateKey',
    'lockScriptAddr',
    'name',
    'publicKey',
    'transferTxHash',
  ],
  properties: {
    broadcastAt: {
      type: 'integer',
    },
    encryptedPrivateKey: {
      type: 'string',
      pattern: hexRegex(160),
    },
    lockScriptAddr: {
      type: 'object',
      required: [
        'hash',
        'version',
      ],
      properties: {
        hash: {
          type: 'object',
          required: [
            'data',
            'type',
          ],
          properties: {
            type: {
              type: 'string',
            },
            data: {
              type: 'array',
              items: {
                type: 'integer',
              },
            },
          },
        },
        version: {
          type: 'integer',
        },
      },
    },
    transferTxHash: {
      type: 'string',
      pattern: hexRegex(64),
    },
    name: {
      type: 'string',
    },
    publicKey: {
      type: 'string',
      pattern: hexRegex(66),
    },
  },
};

export async function validateAuction(auction, nodeClient) {
  const res = jsonSchemaValidate(auction, auctionSchema);
  if (!res.valid) {
    throw new Error('Invalid auction schema.');
  }
}

export function fromAuctionJSON(json) {
  return {
    version: json.version,
    name: json.name,
    lockingTxHash: json.lockingTxHash,
    lockingOutputIdx: json.lockingOutputIdx,
    publicKey: json.publicKey,
    paymentAddr: json.paymentAddr,
    feeAddr: json.feeAddr,
    expiresAt: json.expiresAt,
    bids: json.data.map(p => ({
      price: p.price,
      fee: p.fee || 0,
      lockTime: p.lockTime,
      signature: p.signature,
    })),
  };
}

export async function getFinalizeFromTransferTx(transferTxHash, name, nodeClient) {
  let finalizeTx, finalizeCoin, finalizeOutputIdx;

  const { info: nameInfo } = await nodeClient.getNameInfo(name);
  const { nameHash } = nameInfo;
  const transferTx = await nodeClient.getTx(transferTxHash);

  if (nameInfo.owner && nameInfo.owner.hash) {
    try {
      const ownerOutputIdx = Number(nameInfo.owner.index);
      const ownerTx = await nodeClient.getTx(nameInfo.owner.hash);
      const ownerOutput = ownerTx?.outputs?.[ownerOutputIdx];

      if (
        ownerOutput
        && ownerOutput.covenant.action === 'FINALIZE'
        && ownerOutput.covenant.items
        && ownerOutput.covenant.items[0] === nameHash
      ) {
        let ownerCoin = null;
        try {
          ownerCoin = await nodeClient.getCoin(nameInfo.owner.hash, ownerOutputIdx);
        } catch (e) {
          ownerCoin = null;
        }

        return {
          tx: ownerTx,
          coin: ownerCoin || {
            ...ownerOutput,
            coinbase: false,
            hash: ownerTx.hash,
            height: ownerTx.height,
            index: ownerOutputIdx,
          },
          outputIdx: ownerOutputIdx,
        };
      }
    } catch (e) {
      // Fall back to the older address-history lookup below.
    }
  }

  let prevoutIndex;
  const transferOutput = transferTx?.outputs.filter((output, i) => {
    if (output.covenant.action === 'TRANSFER'
      && output.covenant.items
      && output.covenant.items[0] === nameHash) {
      prevoutIndex = i;
      return true;
    }
  })[0];

  let transactions = null;
  if (transferOutput) {
    try {
      transactions = await nodeClient.getTXByAddresses([transferOutput.address]);
    } catch (e) {
      transactions = null;
    }
  }

  finalizeTx = transactions
    ? transactions.filter((transaction) => {
      return transaction.inputs.filter(input => {
        return input.prevout.hash === transferTx.hash
          && input.prevout.index === prevoutIndex;
      })[0];
    })[0]
    : null;

  if (finalizeTx) {
    const txHash = finalizeTx.hash;
    finalizeOutputIdx = 0;

    for (let i = 0; i < finalizeTx.outputs.length; i++) {
      const covenant = finalizeTx.outputs[i].covenant;
      if (covenant.action === 'FINALIZE' && covenant.items[0] === nameHash) {
        finalizeOutputIdx = i;
        continue;
      }
    }

    finalizeCoin = await nodeClient.getCoin(
      txHash,
      finalizeOutputIdx,
    );
  }

  return {
    tx: finalizeTx,
    coin: finalizeCoin,
    outputIdx: finalizeOutputIdx,
  };
}

export function listingStatusToI18nKey(status) {
  return {
    [LISTING_STATUS.NOT_FOUND]: 'shakedexStatusNotFound',
    [LISTING_STATUS.SOLD]: 'shakedexStatusSold',
    [LISTING_STATUS.SALE_PENDING]: 'shakedexStatusSalePending',
    [LISTING_STATUS.ACTIVE]: 'shakedexStatusActive',
    [LISTING_STATUS.TRANSFER_CONFIRMING]: 'shakedexStatusTransferConfirming',
    [LISTING_STATUS.TRANSFER_CONFIRMED]: 'shakedexStatusTransferConfirmed',
    [LISTING_STATUS.TRANSFER_CONFIRMED_LOCKUP]: 'shakedexStatusTransferConfirmedLockup',
    [LISTING_STATUS.FINALIZE_CONFIRMING]: 'shakedexStatusFinalizeConfirming',
    [LISTING_STATUS.FINALIZE_CONFIRMED]: 'shakedexStatusFinalizeConfirmed',
    [LISTING_STATUS.CANCEL_CONFIRMING]: 'shakedexStatusCancelConfirming',
    [LISTING_STATUS.CANCEL_CONFIRMED]: 'shakedexStatusCancelConfirmed',
    [LISTING_STATUS.FINALIZE_CANCEL_CONFIRMING]: 'shakedexStatusFinalizeCancelConfirming',
    [LISTING_STATUS.FINALIZE_CANCEL_CONFIRMED]: 'shakedexStatusFinalizeCancelConfirmed',
  }[status];
};

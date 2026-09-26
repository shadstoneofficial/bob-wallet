const {Lock} = require('bmutex');

export class WalletMutationCoordinator {
  constructor() {
    this.lock = new Lock();
  }

  async run(task) {
    const unlock = await this.lock.lock();
    try {
      return await task();
    } finally {
      unlock();
    }
  }
}

export function createBroadcastError(error, txid) {
  const reason = error && error.message ? error.message : 'Network acceptance could not be established.';
  const isConflict = error?.code === 'ETXREJECTED'
    || /bad-txns-inputs-spent|inputs?[- ]spent|conflict|duplicate/i.test(reason);

  if (isConflict) {
    return new Error(
      `Transaction ${txid} was rejected by the network and may conflict with another pending transaction. `
      + 'Wait for the earlier transaction to confirm, then retry.',
    );
  }

  return new Error(`Transaction ${txid} was not accepted by the network: ${reason}`);
}

export function reserveTransactionInputs(wallet, mtx) {
  const prevouts = mtx.inputs.map(input => input.prevout);

  for (const prevout of prevouts) {
    wallet.lockCoin(prevout);
  }

  return () => {
    for (const prevout of prevouts) {
      wallet.unlockCoin(prevout);
    }
  };
}

export async function broadcastAndRecord({mtx, walletDB, broadcast}) {
  const tx = mtx.toTX();
  const txid = tx.txid();

  try {
    await broadcast(tx);
  } catch (error) {
    throw createBroadcastError(error, txid);
  }

  try {
    await walletDB.addTX(tx);
  } catch (error) {
    const reason = error?.message || 'Local wallet history could not be updated.';
    const recordError = new Error(
      `Transaction ${txid} was accepted by the network, but Bob could not record it in wallet history: ${reason}`,
    );
    recordError.code = 'ETXRECORD';
    recordError.txid = txid;
    throw recordError;
  }
  return mtx;
}

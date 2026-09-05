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

export async function broadcastAndRecord({mtx, walletDB, broadcast}) {
  const tx = mtx.toTX();
  const txid = tx.txid();

  try {
    await broadcast(tx);
  } catch (error) {
    throw createBroadcastError(error, txid);
  }

  await walletDB.addTX(tx);
  return mtx;
}

export function getTxHash(tx) {
  if (!tx) {
    return null;
  }

  if (typeof tx.hash === 'string') {
    return tx.hash;
  }

  if (typeof tx.txid === 'string') {
    return tx.txid;
  }

  if (typeof tx.id === 'string') {
    return tx.id;
  }

  return null;
}

export function formatTxHash(tx) {
  const hash = getTxHash(tx);
  return hash || 'unknown';
}

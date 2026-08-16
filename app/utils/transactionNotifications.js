export function formatRegisterSuccess(result = {}) {
  const names = Array.isArray(result.names) ? result.names.filter(Boolean) : [];
  const txids = Array.isArray(result.txids) ? result.txids.filter(Boolean) : [];
  const fallbackTxid = typeof result.txid === 'string' ? result.txid.trim() : '';
  const transactionCount = txids.length || (fallbackTxid ? 1 : 0);

  if (transactionCount > 1 || names.length > 1) {
    const nameCount = names.length;
    const transactionLabel = `${transactionCount} transaction${transactionCount === 1 ? '' : 's'}`;
    const nameLabel = nameCount
      ? ` for ${nameCount} name${nameCount === 1 ? '' : 's'}`
      : '';

    return `Registration submitted in ${transactionLabel}${nameLabel}. `
      + 'They will appear as registered after confirmation.';
  }

  const nameLabel = names.length ? ` for ${names[0]}` : '';
  const txid = txids[0] || fallbackTxid;
  const txLabel = txid ? ` Tx: ${txid}.` : '';

  return `Registration submitted${nameLabel}.${txLabel} `
    + 'It will appear as registered after confirmation.';
}

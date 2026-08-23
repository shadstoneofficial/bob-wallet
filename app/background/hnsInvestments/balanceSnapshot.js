export function balanceSnapshot(balance) {
  const json = balance && typeof balance.toJSON === 'function'
    ? balance.toJSON(true)
    : (balance || {});

  const confirmed = Number(json.confirmed || 0);
  const unconfirmed = Number(json.unconfirmed || 0);
  const lockedConfirmed = Number(json.lockedConfirmed || 0);
  const lockedUnconfirmed = Number(json.lockedUnconfirmed || 0);

  return {
    confirmed,
    unconfirmed,
    lockedConfirmed,
    lockedUnconfirmed,
    spendable: Math.max(unconfirmed - lockedUnconfirmed, 0),
  };
}

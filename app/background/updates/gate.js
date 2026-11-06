// One main-process fence covers the gap between the final idle check and quit.
// Admission is synchronous: no renderer command can slip through an await.
export class UpdateGate {
  active = 0;
  closing = false;

  enter(method) {
    if (method.startsWith('Updates.')) return () => {};
    if (this.closing) throw Object.assign(new Error('Bob is closing for an update.'), {code: 'UPDATE_CLOSING'});
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }

  acquire(isBusy) {
    if (this.closing || this.active || isBusy()) {
      throw Object.assign(new Error('Wait for wallet operations to finish before installing.'), {code: 'UPDATE_WALLET_BUSY'});
    }
    this.closing = true;
  }
}

export function walletIsBusy(wallet) {
  if (!wallet || !wallet.recoveryAdmission || !wallet.walletMutationCoordinator
      || !(wallet.preparedBidManyAttempts instanceof Map)) return true;
  return wallet.recoveryAdmission.isBusy()
    || wallet.heightBeforeRescan !== null
    || wallet.walletMutationCoordinator.pending > 0
    || !!wallet.registerAllJournal?.active
    || !!wallet.registerAllJournal?.checking
    || [...wallet.preparedBidManyAttempts.values()].some(attempt => !['submitted', 'cancelled'].includes(attempt.status));
}

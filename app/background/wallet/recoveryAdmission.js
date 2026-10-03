const ACTIVE_STATUSES = new Set(['waiting', 'scanning', 'failed']);

export function createRecoveryAdmission(getRescanState) {
  const admissions = new Set();
  const rescans = new Set();

  const isBusy = () => admissions.size > 0
    || rescans.size > 0
    || ACTIVE_STATUSES.has(getRescanState()?.status);

  return {
    beginImport() {
      if (isBusy()) {
        const failed = getRescanState()?.status === 'failed';
        const error = new Error(failed
          ? 'Wallet recovery is incomplete. Restart Bob before restoring or importing again.'
          : 'Wallet recovery is queued or in progress. Wait for Sync status to finish before restoring or importing again.');
        error.code = 'WALLET_RECOVERY_BUSY';
        throw error;
      }

      const token = {};
      admissions.add(token);
      return token;
    },

    beginRescan(admission) {
      if (admission) admissions.delete(admission);
      const token = {};
      rescans.add(token);
      return () => rescans.delete(token);
    },

    releaseImport(admission) {
      if (admission) admissions.delete(admission);
    },

    finishRescans() {
      rescans.clear();
    },

    isBusy,
  };
}

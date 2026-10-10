export function balanceReadiness(props) {
  if (props.balanceReady !== true) return 'wallet-snapshot-pending';
  if (props.walletSync) return 'wallet-rescanning';

  const chain = props.chain || {progress: props.progress};
  if (Number.isFinite(chain.height) && Number.isFinite(chain.bestPeerHeight)
      && chain.height < chain.bestPeerHeight) return 'chain-behind-peer';
  if (chain.synced !== true && chain.progress !== 1) return 'chain-not-synced';

  const amounts = ['spendableBalance', 'lockedUnconfirmed', 'confirmedBalance', 'unconfirmedBalance'];
  if (!amounts.every(key => Number.isSafeInteger(props[key]) && props[key] >= 0)) {
    return 'invalid-wallet-amounts';
  }
  if (props.spendableBalance + props.lockedUnconfirmed !== props.unconfirmedBalance) {
    return 'wallet-amounts-disagree';
  }
  return 'ready';
}

import React, { Component } from "react";
import { withRouter } from "react-router-dom";
import PropTypes from "prop-types";
import c from "classnames";
import { connect } from "react-redux";
import "./sync-status.scss";
import {I18nContext} from "../../utils/i18n";

export const SYNC_COMPLETE_THRESHOLD = 0.99995;

export function isSyncComplete(chain = {}) {
  const {progress, height, bestPeerHeight, synced} = chain;

  if (Number.isFinite(height)
      && Number.isFinite(bestPeerHeight)
      && height < bestPeerHeight) {
    return false;
  }

  if (synced === true) {
    return true;
  }

  return Number.isFinite(progress) && progress >= SYNC_COMPLETE_THRESHOLD;
}

export function formatSyncProgress(progress, isSynchronized = false) {
  if (!Number.isFinite(progress)) {
    return '';
  }

  const percent = Math.max(0, progress * 100);
  const displayedPercent = isSynchronized
    ? Math.min(100, percent)
    : Math.min(99.99, percent);

  return `(${displayedPercent.toFixed(2)}%)`;
}

export function getSyncStatusText(props, t) {
  const {
    isSynchronized,
    isSynchronizing,
    progress,
    isCustomRPCConnected,
    isChangingNodeStatus,
    isTestingCustomRPC,
    walletSync,
    walletHeight,
    rescanHeight,
    storageBlocked,
  } = props;

  if (storageBlocked) {
    return t('storageErrorSyncStatus');
  }

  if (walletSync) {
    const percentText = Math.floor((walletHeight * 100) / rescanHeight);
    return isCustomRPCConnected
      ? `${t('rescanningFromRPC')}... (${percentText}%)`
      : `${t('rescanning')}... (${percentText}%)`;
  }

  if (isSynchronizing) {
    const progressText = formatSyncProgress(progress, isSynchronized);
    return isCustomRPCConnected
      ? `${t('synchronizingFromRPC')}... ${progressText}`
      : `${t('synchronizing')}... ${progressText}`;
  }

  if (isSynchronized) {
    return isCustomRPCConnected
      ? t('synchronizedFromRPC')
      : t('synchronized');
  }

  if (isChangingNodeStatus || isTestingCustomRPC) {
    return t('pleaseWait');
  }

  return t('noConnection');
}

@withRouter
@connect((state) => {
  const {
    chain,
    isRunning,
    isCustomRPCConnected,
    isChangingNodeStatus,
    isTestingCustomRPC,
  } = state.node;
  const { progress } = chain || {};
  const syncComplete = isSyncComplete(chain);

  return {
    isRunning,
    isCustomRPCConnected,
    isChangingNodeStatus,
    isTestingCustomRPC,
    isSynchronizing: isRunning && !syncComplete,
    isSynchronized: isRunning && syncComplete,
    progress,
    walletSync: state.wallet.walletSync,
    walletHeight: state.wallet.walletHeight,
    rescanHeight: state.wallet.rescanHeight,
    chainHeight: state.node.chain.height,
    storageBlocked: state.storage.blocked,
  };
})
class SyncStatus extends Component {
  static propTypes = {
    isRunning: PropTypes.bool.isRequired,
    isCustomRPCConnected: PropTypes.bool.isRequired,
    isSynchronizing: PropTypes.bool.isRequired,
    isSynchronized: PropTypes.bool.isRequired,
    isChangingNodeStatus: PropTypes.bool.isRequired,
    isTestingCustomRPC: PropTypes.bool.isRequired,
    walletSync: PropTypes.bool.isRequired,
    walletHeight: PropTypes.number.isRequired,
    rescanHeight: PropTypes.number,
    chainHeight: PropTypes.number.isRequired,
    storageBlocked: PropTypes.bool.isRequired,
  };

  static contextType = I18nContext;

  render() {
    const {
      isSynchronized,
      isSynchronizing,
      isChangingNodeStatus,
      isTestingCustomRPC,
      isRunning,
      walletSync,
      progress,
      storageBlocked,
    } = this.props;

    return (
      <React.Fragment>
        <div
          className={c("sync-status", {
            "sync-status--success": isSynchronized && !storageBlocked,
            "sync-status--failure": !isRunning || storageBlocked,
            "sync-status--loading":
              !storageBlocked && (walletSync ||
              isChangingNodeStatus ||
              isTestingCustomRPC ||
              isSynchronizing),
          })}
        >
          {this.getSyncText()}
        </div>
      </React.Fragment>
    );
  }

  getSyncText() {
    const {t} = this.context;
    return getSyncStatusText(this.props, t);
  }
}

export default SyncStatus;

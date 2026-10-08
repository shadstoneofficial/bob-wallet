import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import c from 'classnames';
import { verifyName } from 'hsd/lib/covenants/rules';
import Network from 'hsd/lib/protocol/network';
import {
  addNamesToBasket,
  removeFromBasket,
  updateBasketItem,
  clearBasket,
  importBasketRows,
  AUCTION_BASKET_LIMIT,
} from '../../ducks/auctionBasket';
import * as nameActions from '../../ducks/names';
import { showError, showSuccess } from '../../ducks/notifications';
import { displayBalance, toBaseUnits } from '../../utils/balances';
import { isBidding } from '../../utils/nameHelpers';
import nodeClient from '../../utils/nodeClient';
import { clientStub as aClientStub } from '../../background/analytics/client';
import { I18nContext } from '../../utils/i18n';
import {basketScope, assertBasketScope, basketScopeError} from '../../utils/basketScope';
import {
  basketToCSV,
  parseBasketDraft,
  parseCompleteBasket,
  serializeBasketDraft,
  splitBasket,
} from '../../utils/auctionBasketData';
import './auction-basket.scss';

const analytics = aClientStub(() => require('electron').ipcRenderer);

// Rough fee buffer: ~0.01 HNS per name in base units for preflight balance check.
const FEE_BUFFER_PER_NAME = 10000;

/** Allow only a decimal amount string (up to 6 places), no scroll-wheel drift. */
function sanitizeAmountInput(value) {
  const match = String(value || '').match(/^\d*\.?\d{0,6}/);
  return match ? match[0] : '';
}

function normalizeAmountInput(value) {
  if (value === '' || value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '';
  // Keep integer display when possible (3000 not 3000.000000).
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

export class AuctionBasket extends Component {
  static propTypes = {
    order: PropTypes.array.isRequired,
    items: PropTypes.object.isRequired,
    spendableBalance: PropTypes.number.isRequired,
    watchOnly: PropTypes.bool,
    walletType: PropTypes.string,
    network: PropTypes.string.isRequired,
    height: PropTypes.number,
    watchingNames: PropTypes.array,
    names: PropTypes.object,
    addNamesToBasket: PropTypes.func.isRequired,
    removeFromBasket: PropTypes.func.isRequired,
    updateBasketItem: PropTypes.func.isRequired,
    clearBasket: PropTypes.func.isRequired,
    importBasketRows: PropTypes.func.isRequired,
    sendBidMany: PropTypes.func.isRequired,
    showError: PropTypes.func.isRequired,
    showSuccess: PropTypes.func.isRequired,
    history: PropTypes.object.isRequired,
    walletId: PropTypes.string,
    basketSubmissionProgress: PropTypes.object,
  };

  static contextType = I18nContext;

  state = {
    singleName: '',
    pasteText: '',
    showPaste: false,
    showCompletePaste: false,
    completePasteText: '',
    importPreview: [],
    importChecking: false,
    savedDraft: null,
    splitSize: 10,
    showSplit: false,
    step: 'edit', // edit | review
    checking: false,
    submissionPhase: 'idle',
    submissionError: '',
    submissionFailedStage: '',
    submissionTxid: '',
    retryAllowed: false,
    broadcastUncertain: false,
    accepted: false,
    reviewedScope: null,
    transactionScope: null,
    submissionRows: [],
    rowMeta: {}, // name -> { state, error, hoursUntilReveal, height, walletHasName }
  };

  componentDidMount() {
    this._mounted = true;
    analytics.screenView('Auction Basket');
    this.loadSavedDraft();
    if (this.props.order.length) {
      this.refreshStatuses();
    }
  }

  componentWillUnmount() {
    this._mounted = false;
    if (['checking', 'rescanning', 'building', 'reviewing', 'signing'].includes(this.state.submissionPhase)) {
      this.submissionRunId += 1;
      this.submissionAbortController?.abort();
    }
    this.confirmPrepared = null;
  }

  componentDidUpdate(prevProps, prevState) {
    if (this._switchingDraft) return;
    if (prevProps.walletId !== this.props.walletId || prevProps.network !== this.props.network) {
      this.submissionRunId += 1;
      this.submissionAbortController?.abort();
      this.confirmPrepared = null;
      // Do not carry the old wallet's receipt/uncertainty into the new wallet,
      // or overwrite its persisted safety lock before reading it.
      this._switchingDraft = true;
      this.safeSetState({accepted: false, reviewedScope: null, transactionScope: null,
        step: 'edit', submissionPhase: 'idle', submissionError: '', submissionFailedStage: '',
        submissionTxid: '', retryAllowed: false, broadcastUncertain: false,
        activeAttemptId: '', submissionRows: [], savedDraft: null, rowMeta: {}}, () => {
        this.loadSavedDraft();
        this._switchingDraft = false;
        if (this.props.order.length) this.refreshStatuses();
      });
      return;
    }
    if (prevProps.order !== this.props.order && this.props.order.length) {
      this.refreshStatuses();
    }
    if (
      prevProps.order !== this.props.order
      || prevProps.items !== this.props.items
      || prevState.step !== this.state.step
      || prevState.broadcastUncertain !== this.state.broadcastUncertain
      || prevState.submissionTxid !== this.state.submissionTxid
    ) {
      if (this.props.order.length) this.persistDraft();
    }
    const progress = this.props.basketSubmissionProgress || {};
    const previousProgress = prevProps.basketSubmissionProgress || {};
    if (
      progress !== previousProgress
      && progress.attemptId
      && progress.attemptId === this.state.activeAttemptId
      && ['building', 'signing', 'broadcasting', 'verifying'].includes(progress.phase)
    ) {
      this.safeSetState({
        submissionPhase: progress.phase,
        submissionTxid: progress.txid || this.state.submissionTxid,
      });
    }
  }

  getDraftKey = () => {
    const {walletId, network} = this.props;
    if (!walletId) return '';
    return `bob-auction-basket-draft-v1:${network || 'main'}:${walletId}`;
  };

  loadSavedDraft = () => {
    const key = this.getDraftKey();
    if (!key || typeof window === 'undefined' || !window.localStorage) return;
    try {
      const draft = parseBasketDraft(window.localStorage.getItem(key), {
        walletId: this.props.walletId,
        network: this.props.network,
      });
      if (draft?.rows?.length || draft?.formState?.broadcastUncertain) {
        const currentRows = this.props.order.map(name => this.props.items[name]);
        const currentMatchesDraft = currentRows.length === draft.rows.length
          && draft.rows.every((row, index) => (
            row.name === this.props.order[index]
            && row.bidAmount === String(currentRows[index]?.bidAmount || '')
            && row.blindAmount === String(currentRows[index]?.blindAmount || '')
          ));
        this.safeSetState({
          savedDraft: draft,
          ...((currentMatchesDraft || draft.formState?.broadcastUncertain) ? this.submissionSafetyFromDraft(draft) : {}),
        });
      }
    } catch (error) {
      console.error('Could not read Auction Basket draft:', error);
    }
  };

  persistDraft = (safety = {}, required = false) => {
    const key = this.getDraftKey();
    if (!key || typeof window === 'undefined' || !window.localStorage) {
      if (required) throw new Error('Cannot save basket recovery state. No transaction was sent.');
      return;
    }
    try {
      window.localStorage.setItem(key, serializeBasketDraft({
        walletId: this.props.walletId,
        network: this.props.network,
        order: this.props.order,
        items: this.props.items,
        formState: {
          step: this.state.step,
          broadcastUncertain: this.state.broadcastUncertain,
          submissionTxid: this.state.submissionTxid,
          submissionError: this.state.submissionError,
          submissionFailedStage: this.state.submissionFailedStage,
          ...safety,
        },
      }));
    } catch (error) {
      if (required) throw new Error('Cannot save basket recovery state. No transaction was sent.');
      console.error('Could not save Auction Basket draft:', error);
    }
  };

  hasUnresolvedSubmission = () => {
    if (this.state.broadcastUncertain || this._submitRunning || this.isSubmissionActive()) return true;
    const key = this.getDraftKey();
    if (!key || typeof window === 'undefined' || !window.localStorage) return false;
    try {
      const draft = parseBasketDraft(window.localStorage.getItem(key), {
        walletId: this.props.walletId, network: this.props.network,
      });
      return !!draft?.formState?.broadcastUncertain;
    } catch (_) {
      return true;
    }
  };

  clearSavedDraft = verifiedResult => {
    const verifiedSuccess = verifiedResult && verifiedResult === this._verifiedSuccessfulSubmission && this._mounted
      && /^[a-f0-9]{64}$/.test(verifiedResult.txid || '')
      && verifiedResult.txid === this.state.submissionTxid
      && this.state.reviewedScope && this.state.transactionScope
      && JSON.stringify(verifiedResult.scope) === JSON.stringify(this.state.transactionScope)
      && JSON.stringify(verifiedResult.scope) === JSON.stringify({
        ...this.state.reviewedScope, fee: this.state.transactionScope.fee,
      });
    if (this.hasUnresolvedSubmission() && !verifiedSuccess) return false;
    const key = this.getDraftKey();
    if (key && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
    this.safeSetState({savedDraft: null});
    return true;
  };

  onClearBasket = () => {
    if (!this.clearSavedDraft()) {
      this.props.showError(this.context.t('basketRetryUncertain'));
      return;
    }
    this.props.clearBasket();
    this.setState({rowMeta: {}, step: 'edit'});
  };

  restoreSavedDraft = () => {
    const draft = this.state.savedDraft;
    if (!draft?.rows?.length) return;
    this.props.importBasketRows(draft.rows, 'replace');
    this.setState({
      step: 'edit',
      accepted: false,
      ...this.submissionSafetyFromDraft(draft),
    });
  };

  submissionSafetyFromDraft = draft => {
    if (!draft?.formState?.broadcastUncertain) return {};
    return {
      submissionPhase: 'failed',
      submissionError: draft.formState.submissionError
        || this.context.t('basketPreviousUncertain'),
      submissionFailedStage: draft.formState.submissionFailedStage || 'broadcasting',
      submissionTxid: draft.formState.submissionTxid || '',
      retryAllowed: false,
      broadcastUncertain: true,
    };
  };

  safeSetState = (nextState, callback) => {
    if (this._mounted) this.setState(nextState, callback);
  };

  isHotWalletCapable = () => {
    const { watchOnly, walletType } = this.props;
    if (watchOnly) return false;
    if (walletType === 'ledger' || walletType === 'multisig') return false;
    return true;
  };

  onAddSingle = () => {
    const { t } = this.context;
    const name = this.state.singleName.trim().toLowerCase().replace(/\/$/, '');
    if (!name) return;

    if (!verifyName(name)) {
      this.props.showError(t('basketInvalidName', name));
      return;
    }

    const result = this.props.addNamesToBasket([name]);
    if (result.limited) {
      this.notifyBasketFull();
    } else if (result.added) {
      this.setState({ singleName: '' });
    } else if (result.skipped) {
      this.props.showError(t('basketAlreadyAdded', name));
    }
  };

  notifyBasketFull = () => {
    const { t } = this.context;
    const { order } = this.props;
    // Informational capacity message — not a crash / protocol failure.
    this.props.showError(
      t('basketLimitReachedHelp', String(order.length), String(AUCTION_BASKET_LIMIT))
    );
  };

  onAddPaste = () => {
    const { t } = this.context;
    const lines = this.state.pasteText
      .split(/[\n,]+/)
      .map((s) => s.trim().toLowerCase().replace(/\/$/, '').replace(/\.hns$/i, ''))
      .filter(Boolean);

    const valid = [];
    for (const name of lines) {
      if (verifyName(name)) {
        valid.push(name);
      }
    }

    if (!valid.length) {
      this.props.showError(t('basketNoValidNames'));
      return;
    }

    const result = this.props.addNamesToBasket(valid);
    if (result.added) {
      this.setState({ pasteText: '', showPaste: false });
      this.props.showSuccess(t('basketAddedCount', String(result.added)));
    }
    if (result.limited) {
      this.notifyBasketFull();
    }
  };

  previewCompleteBasket = async () => {
    const rows = parseCompleteBasket(this.state.completePasteText, AUCTION_BASKET_LIMIT, this.context.t);
    if (!rows.length) {
      this.props.showError(this.context.t('basketImportNoRows'));
      return;
    }
    this.setState({importChecking: true, importPreview: rows});
    const net = Network.get(this.props.network || 'main');
    const checked = await Promise.all(rows.map(async row => {
      if (row.errors.length) return row;
      try {
        const info = await nodeClient.getNameInfo(row.name);
        const bidding = isBidding({
          start: info.start,
          info: info.info,
          pendingOperation: this.props.names?.[row.name]?.pendingOperation,
        });
        const state = info.info?.state || (info.start ? 'AVAILABLE' : 'UNKNOWN');
        return {
          ...row,
          auctionState: bidding ? 'BIDDING' : state,
          hoursUntilReveal: info.info?.stats?.hoursUntilReveal,
          height: info.info?.height != null ? info.info.height - 1 : null,
          targetSpacing: net.pow.targetSpacing,
          errors: bidding ? row.errors : [...row.errors, this.context.t('basketAuctionNotBidding', state)],
        };
      } catch (error) {
        return {...row, auctionState: 'ERROR', errors: [...row.errors, error.message || this.context.t('basketLookupFailed')]};
      }
    }));
    this.safeSetState({importPreview: checked, importChecking: false});
  };

  applyCompleteBasket = (mode) => {
    const valid = this.state.importPreview.filter(row => row.errors.length === 0);
    if (!valid.length) {
      this.props.showError(this.context.t('basketImportNoValidRows'));
      return;
    }
    let rows = valid;
    if (mode === 'add') rows = rows.filter(row => !this.props.items[row.name]);
    const currentCount = mode === 'replace' ? 0 : this.props.order.length;
    if (currentCount + rows.length > AUCTION_BASKET_LIMIT) {
      this.props.showError(this.context.t('basketImportLimit', String(AUCTION_BASKET_LIMIT)));
      return;
    }
    if (!rows.length) {
      this.props.showError(this.context.t('basketImportAllPresent'));
      return;
    }
    this.props.importBasketRows(rows, mode);
    this.setState({
      completePasteText: '',
      importPreview: [],
      showCompletePaste: false,
      accepted: false,
      step: 'edit',
    });
    this.props.showSuccess(this.context.t('basketImportedRows', String(rows.length)));
  };

  copyText = async (text, message) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    this.props.showSuccess(message);
  };

  copyBasket = () => this.copyText(
    basketToCSV(this.props.order, this.props.items),
    this.context.t('basketCopiedCSV'),
  );

  exportBasketCSV = () => {
    const csv = basketToCSV(this.props.order, this.props.items);
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `bob-auction-basket-${this.props.walletId || 'wallet'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  csvForRows = rows => {
    const items = {};
    const order = [];
    for (const row of rows) {
      order.push(row.name);
      items[row.name] = row;
    }
    return basketToCSV(order, items);
  };

  onAddFromWatchlist = async () => {
    const { t } = this.context;
    const names = this.props.watchingNames || [];
    if (!names.length) {
      this.props.showError(t('basketWatchlistEmpty'));
      return;
    }

    this.setState({ checking: true });
    try {
      // Prefer names currently in BIDDING so watchlist import does not fill
      // all 20 slots with OPENING / closed names you cannot bid on yet.
      const bidding = [];
      for (const name of names) {
        try {
          const info = await nodeClient.getNameInfo(name);
          if (isBidding({
            start: info.start,
            info: info.info,
            pendingOperation: this.props.names?.[name]?.pendingOperation,
          })) {
            bidding.push(name);
          }
        } catch (e) {
          // skip lookup failures
        }
      }

      if (!bidding.length) {
        this.props.showError(t('basketWatchlistNoBidding'));
        return;
      }

      const result = this.props.addNamesToBasket(bidding);
      if (result.added) {
        this.props.showSuccess(
          t('basketAddedBiddingFromWatchlist', String(result.added), String(bidding.length))
        );
        await this.refreshStatuses();
      }
      if (result.limited && result.added) {
        this.props.showSuccess(
          t('basketFilledWithBidding', String(AUCTION_BASKET_LIMIT))
        );
      } else if (result.limited && !result.added) {
        this.notifyBasketFull();
      }
      if (!result.added && result.skipped && !result.limited) {
        this.props.showError(t('basketNothingNew'));
      }
    } finally {
      this.setState({ checking: false });
    }
  };

  refreshStatuses = async () => {
    const { order, network, walletId } = this.props;
    const update = patch => {
      if (this.props.order === order && this.props.network === network && this.props.walletId === walletId) {
        this.safeSetState(patch);
      }
    };
    if (!order.length) {
      this.safeSetState({ rowMeta: {}, checking: false });
      return {};
    }

    this.safeSetState({ checking: true });
    const rowMeta = {};
    const net = Network.get(network || 'main');

    try {
      await Promise.all(order.map(async (name) => {
        try {
          const info = await nodeClient.getNameInfo(name);
          const domain = {
            start: info.start,
            info: info.info,
            pendingOperation: this.props.names?.[name]?.pendingOperation,
          };
          const state = info.info?.state || (info.start ? 'AVAILABLE' : 'UNKNOWN');
          const bidding = isBidding(domain);
          const hoursUntilReveal = info.info?.stats?.hoursUntilReveal;
          // Always keep import height when known. SPV wallets need importname
          // even if the UI already loaded name info from the node.
          const height = info.info?.height != null ? info.info.height - 1 : null;
          const walletHasName = !!this.props.names?.[name]?.walletHasName;

          let error = '';
          if (!bidding) {
            error = state === 'OPENING'
              ? this.context.t('opening')
              : state === 'REVEAL'
                ? this.context.t('inReveals')
                : state === 'CLOSED'
                  ? this.context.t('closed')
                  : this.context.t('basketNotBidding');
          }

          rowMeta[name] = {
            state: bidding ? 'BIDDING' : state,
            error,
            hoursUntilReveal,
            height,
            walletHasName,
            targetSpacing: net.pow.targetSpacing,
          };
        } catch (e) {
          rowMeta[name] = {
            state: 'ERROR',
            error: e.message || this.context.t('basketLookupFailed'),
            hoursUntilReveal: null,
            height: null,
            walletHasName: false,
          };
        }
      }));
      update({ rowMeta, checking: false });
      return rowMeta;
    } catch (e) {
      update({ checking: false });
      throw e;
    }
  };

  isAmountOk = (item) => {
    const bid = Number(item?.bidAmount);
    const blind = Number(item?.blindAmount || 0);
    const lockup = bid + blind;
    // Match single-name Bid Now: true bid may be 0 if blind/lockup > 0.
    return Number.isFinite(bid) && bid >= 0
      && Number.isFinite(blind) && blind >= 0
      && (bid > 0 || blind > 0)
      && lockup >= bid;
  };

  /** Empty or 0/0 — leave in the list but do not submit or block review. */
  isAmountEmpty = (item) => {
    const bid = Number(item?.bidAmount);
    const blind = Number(item?.blindAmount || 0);
    const bidN = Number.isFinite(bid) ? bid : 0;
    const blindN = Number.isFinite(blind) ? blind : 0;
    return bidN === 0 && blindN === 0;
  };

  getRowTotals = (rowMetaOverride) => {
    const { order, items } = this.props;
    const rowMeta = rowMetaOverride || this.state.rowMeta;
    let totalBid = 0;
    let totalBlind = 0;
    let totalLockup = 0;
    let validCount = 0;
    let notBiddingCount = 0;
    let badAmountCount = 0;
    let skippedEmptyCount = 0;
    let earliestHours = null;
    const validNames = [];

    for (const name of order) {
      const item = items[name] || {};
      const meta = rowMeta[name] || {};
      const bid = Number(item.bidAmount) || 0;
      const blind = Number(item.blindAmount || 0);
      const lockup = bid + blind;
      const amountsOk = this.isAmountOk(item);
      const amountEmpty = this.isAmountEmpty(item);
      const stateOk = !meta.error && meta.state === 'BIDDING';

      if (stateOk && amountsOk) {
        validCount += 1;
        validNames.push(name);
        totalBid += bid;
        totalBlind += blind;
        totalLockup += lockup;
        if (meta.hoursUntilReveal != null) {
          if (earliestHours == null || meta.hoursUntilReveal < earliestHours) {
            earliestHours = meta.hoursUntilReveal;
          }
        }
      } else if (!stateOk) {
        notBiddingCount += 1;
      } else if (amountEmpty) {
        // Already bid earlier, or intentionally left blank — skip on submit.
        skippedEmptyCount += 1;
      } else {
        badAmountCount += 1;
      }
    }

    const feeBuffer = validCount * (FEE_BUFFER_PER_NAME / 1e6);
    return {
      totalBid,
      totalBlind,
      totalLockup,
      validCount,
      notBiddingCount,
      badAmountCount,
      skippedEmptyCount,
      validNames,
      earliestHours,
      feeBuffer,
      needed: totalLockup + feeBuffer,
    };
  };

  canReview = (rowMetaOverride) => {
    if (!this.isHotWalletCapable()) return false;
    if (!this.props.order.length) return false;
    const totals = this.getRowTotals(rowMetaOverride);
    // Empty rows may stay as a draft, but every funded row must be eligible.
    const hasIneligibleBid = this.props.order.some(name => !this.isAmountEmpty(this.props.items[name])
      && (rowMetaOverride || this.state.rowMeta)[name]?.state !== 'BIDDING');
    return totals.validCount > 0 && totals.badAmountCount === 0 && !hasIneligibleBid;
  };

  removeEmptyAmountRows = () => {
    const { order, items, removeFromBasket } = this.props;
    let removed = 0;
    for (const name of [...order]) {
      if (this.isAmountEmpty(items[name])) {
        removeFromBasket(name);
        removed += 1;
      }
    }
    if (removed) {
      this.props.showSuccess(this.context.t('basketRemovedEmpty', String(removed)));
    } else {
      this.props.showError(this.context.t('basketNothingNew'));
    }
  };

  removeNonBidding = () => {
    const { order, removeFromBasket } = this.props;
    const { rowMeta } = this.state;
    let removed = 0;
    for (const name of [...order]) {
      const meta = rowMeta[name];
      if (!meta || meta.error || meta.state !== 'BIDDING') {
        removeFromBasket(name);
        removed += 1;
      }
    }
    if (removed) {
      this.props.showSuccess(this.context.t('basketRemovedNonBidding', String(removed)));
    } else {
      this.props.showError(this.context.t('basketNothingNew'));
    }
  };

  applyAmountsToBidding = () => {
    const { t } = this.context;
    const { order, items, updateBasketItem } = this.props;
    const { rowMeta } = this.state;
    // Use first bidding row that has amounts as the template.
    let template = null;
    for (const name of order) {
      const item = items[name];
      if (this.isAmountOk(item)) {
        template = item;
        break;
      }
    }
    if (!template) {
      this.props.showError(t('basketNeedAmountTemplate'));
      return;
    }
    let updated = 0;
    for (const name of order) {
      const meta = rowMeta[name] || {};
      const item = items[name] || {};
      // Only fill bidding rows that are still empty — do not overwrite
      // amounts the user already set, and do not force re-bids.
      if (meta.state === 'BIDDING' && !meta.error && this.isAmountEmpty(item)) {
        updateBasketItem(name, {
          bidAmount: template.bidAmount,
          blindAmount: template.blindAmount,
        });
        updated += 1;
      }
    }
    if (updated) {
      this.props.showSuccess(t('basketAppliedAmounts', String(updated)));
    } else {
      this.props.showError(t('basketNothingNew'));
    }
  };

  goReview = async () => {
    const { t } = this.context;
    const {walletId, network, order} = this.props;
    try {
      const rowMeta = await this.refreshStatuses();
      if (!this._mounted || walletId !== this.props.walletId || network !== this.props.network
          || order !== this.props.order) return;
      if (!this.canReview(rowMeta)) {
        this.props.showError(t('basketFixRowsBeforeReview'));
        return;
      }
      const totals = this.getRowTotals(rowMeta);
      if (totals.needed * 1e6 > (this.props.spendableBalance || 0)) {
        this.props.showError(t('basketInsufficientBalance'));
      }
      const reviewedScope = this.currentBasketScope();
      this.safeSetState({ step: 'review', accepted: false, reviewedScope, transactionScope: null });
    } catch (e) {
      this.props.showError(e.message || t('basketFixRowsBeforeReview'));
    }
  };

  submissionRunId = 0;

  submissionAbortController = null;

  currentBasketScope = () => basketScope(this.props.order
    .filter(name => !this.isAmountEmpty(this.props.items[name]))
    .map(name => {
      const item = this.props.items[name];
      const bid = Number(toBaseUnits(item.bidAmount));
      const blind = Number(toBaseUnits(item.blindAmount || 0));
      return {name, bid, lockup: bid + blind};
    }));

  onConfirmPrepared = () => {
    if (!this.state.accepted || !this.confirmPrepared) return;
    const resolve = this.confirmPrepared;
    this.confirmPrepared = null;
    resolve(this.state.transactionScope);
  };

  isSubmissionActive = () => [
    'checking',
    'rescanning',
    'building',
    'reviewing',
    'signing',
    'broadcasting',
    'verifying',
  ].includes(this.state.submissionPhase);

  onBackToBasket = () => {
    const preserveSafetyLock = this.state.broadcastUncertain;
    if (['checking', 'rescanning', 'building', 'reviewing', 'signing'].includes(this.state.submissionPhase)) {
      this.submissionRunId += 1;
      this.submissionAbortController?.abort();
    }
    this.confirmPrepared = null;
    this.setState({
      step: 'edit',
      submissionPhase: preserveSafetyLock ? 'failed' : 'idle',
      submissionError: preserveSafetyLock ? this.state.submissionError : '',
      submissionFailedStage: preserveSafetyLock ? this.state.submissionFailedStage : '',
      retryAllowed: false,
      broadcastUncertain: preserveSafetyLock,
      accepted: false,
      reviewedScope: null,
      transactionScope: null,
    });
  };

  onSubmit = async () => {
    const { t } = this.context;
    const {
      sendBidMany,
      clearBasket,
      showError,
      showSuccess,
    } = this.props;
    const { accepted } = this.state;

    if (this._submitRunning || this.isSubmissionActive() || this.state.broadcastUncertain) return;
    if (!accepted) {
      showError(t('basketMustAccept'));
      return;
    }
    if (!this.isHotWalletCapable()) {
      showError(t('basketHotWalletOnly'));
      return;
    }
    if (!this.state.reviewedScope) {
      showError(t('basketScopeReviewRequired'));
      return;
    }

    this._submitRunning = true;
    const runId = ++this.submissionRunId;
    const walletId = this.props.walletId;
    const network = this.props.network;
    const reviewedScope = this.state.reviewedScope;
    const assertCurrent = () => {
      if (!this._mounted || runId !== this.submissionRunId
          || walletId !== this.props.walletId || network !== this.props.network) {
        throw basketScopeError('The basket screen or selected wallet changed.');
      }
      assertBasketScope(this.currentBasketScope(), reviewedScope);
    };
    this.submissionAbortController = new AbortController();
    const signal = this.submissionAbortController.signal;
    this.setState({
      submissionPhase: 'checking',
      submissionError: '',
      submissionFailedStage: '',
      submissionTxid: '',
      retryAllowed: false,
      broadcastUncertain: false,
      activeAttemptId: '',
    });

    try {
      assertCurrent();
      const rowMeta = await nameActions.waitForControlledPromise(this.refreshStatuses(), {
        signal, timeoutMs: 60000,
        timeoutError: basketScopeError('Auction status lookup timed out.'),
      });
      if (signal.aborted || runId !== this.submissionRunId) return;
      assertCurrent();
      const entries = reviewedScope.rows.map(row => {
        const {name} = row;
        const meta = rowMeta[name] || {};
        if (meta.error || meta.state !== 'BIDDING') {
          throw basketScopeError(`${name}/ is ${meta.state || 'unavailable'}, not bidding.`);
        }
        return {...row, height: meta.height};
      });

      const res = await sendBidMany(entries, {
        signal,
        assertCurrent,
        confirmScope: scope => new Promise(resolve => {
          assertCurrent();
          assertBasketScope(scope, {...reviewedScope, fee: scope.fee});
          this.confirmPrepared = resolve;
          this.safeSetState({transactionScope: scope, submissionPhase: 'reviewing', accepted: false});
        }),
        onPhase: (phase, details = {}) => {
          if (!this._mounted || runId !== this.submissionRunId) return;
          if (phase === 'broadcasting') {
            // Persist the uncertainty lock synchronously BEFORE invoking the
            // background broadcast RPC, including when the renderer later exits.
            this.persistDraft({broadcastUncertain: true, submissionTxid: details.txid || '',
              submissionFailedStage: 'broadcasting', submissionError: t('basketRetryUncertain')}, true);
          }
          this.setState({
            submissionPhase: phase,
            submissionError: details.error || '',
            submissionFailedStage: details.failedStage || '',
            retryAllowed: !!details.retryAllowed,
            broadcastUncertain: ['broadcasting', 'verifying', 'submitted'].includes(phase) || !!details.broadcastUncertain,
            submissionTxid: details.txid || this.state.submissionTxid,
            activeAttemptId: details.attemptId || this.state.activeAttemptId,
          });
        },
      });
      if (res?.txid) {
        if (!/^[a-f0-9]{64}$/.test(res.txid)
            || JSON.stringify(res.scope) !== JSON.stringify({...reviewedScope, fee: this.state.transactionScope?.fee})) {
          const error = new Error(t('basketRetryUncertain'));
          error.broadcastUncertain = true;
          error.txid = res.txid;
          error.stage = 'verifying';
          throw error;
        }
        if (this._mounted && runId === this.submissionRunId) {
          // A late success must not erase edits made after the reviewed request.
          if (JSON.stringify(this.currentBasketScope()) !== JSON.stringify(reviewedScope)) return;
          this._verifiedSuccessfulSubmission = res;
          if (entries.length === this.props.order.length) {
            this.clearSavedDraft(res);
            clearBasket();
          } else {
            entries.forEach(entry => this.props.removeFromBasket(entry.name));
          }
          this._verifiedSuccessfulSubmission = null;
          showSuccess(t('basketSubmitSuccess', String(entries.length)));
          const tracking = analytics.track('auction basket bid', { count: entries.length });
          if (tracking?.catch) tracking.catch(() => {});
          this.setState({
            submissionPhase: 'submitted',
            submissionTxid: res.txid,
            broadcastUncertain: false,
            retryAllowed: false,
            savedDraft: null,
            submittedCount: entries.length,
            submissionRows: entries.map(entry => ({name: entry.name, status: 'submitted'})),
          });
        }
      } else {
        const error = new Error(t('basketRetryUncertain'));
        error.broadcastUncertain = true;
        throw error;
      }
    } catch (e) {
      if (e?.code === 'BASKET_SUBMISSION_CANCELLED') return;
      if (this._mounted && runId === this.submissionRunId) {
        showError(e.message || t('basketSubmitFailed'));
        const resultRows = rowMeta => reviewedScope.rows.map(row => ({
          name: row.name,
          status: e.broadcastUncertain ? 'uncertain'
            : ['REVEAL', 'CLOSED'].includes(rowMeta[row.name]?.state) ? 'expired' : 'failed',
        }));
        this.setState({
          submissionPhase: 'failed',
          submissionError: e.message || t('basketSubmitFailed'),
          submissionFailedStage: e.stage || this.state.submissionPhase,
          retryAllowed: !!e.retryAllowed,
          broadcastUncertain: !!e.broadcastUncertain,
          accepted: false,
          transactionScope: null,
          submissionTxid: e.txid || this.state.submissionTxid,
          submissionRows: resultRows(this.state.rowMeta),
        });
        // Metadata refresh must not delay recovery controls or the actual error.
        this.refreshStatuses().then(rowMeta => {
          if (this._mounted && runId === this.submissionRunId) {
            this.setState({submissionRows: resultRows(rowMeta)});
          }
        }).catch(() => {});
      }
    } finally {
      this._submitRunning = false;
      this.confirmPrepared = null;
    }
  };

  formatSubmissionStage = stage => {
    const keys = {
      checking: 'basketStageChecking', rescanning: 'basketStageRescanning',
      building: 'basketStageBuilding', signing: 'basketStageSigning',
      reviewing: 'basketExactReview',
      broadcasting: 'basketStageBroadcasting', verifying: 'basketStageVerifying',
    };
    return this.context.t(keys[stage] || 'basketStagePreparation');
  };

  formatTime = (hours) => {
    if (hours == null || !Number.isFinite(hours)) return '—';
    if (hours < 24) {
      const h = Math.floor(hours);
      const m = Math.floor((hours - h) * 60);
      return this.context.t('durationHoursMinutes', String(h), String(m));
    }
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours - d * 24);
    return this.context.t('durationDaysHours', String(d), String(h));
  };

  render() {
    const { t } = this.context;
    const { order } = this.props;
    const { step } = this.state;

    if (this.state.submissionPhase === 'submitted') {
      return (
        <div className="auction-basket">
          <section className="auction-basket__panel auction-basket__submission-status auction-basket__submission-status--success">
            <h3>{t('basketSubmittedTitle')}</h3>
            <p>{t('basketBroadcastCount', String(this.state.submittedCount))}</p>
            <label>{t('transactionID')}</label>
            <code>{this.state.submissionTxid}</code>
            {this.renderSubmissionRows()}
            <div className="auction-basket__footer-actions">
              <button
                type="button"
                className="auction-basket__btn"
                onClick={() => this.props.history.push('/bids/BIDDING')}
              >
                {t('basketViewBids')}
              </button>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="auction-basket">
        <div className="auction-basket__intro">
          <h2>{t('basketTitle')}</h2>
          <p>{t('basketSubtitle')}</p>
        </div>

        {!this.isHotWalletCapable() && (
          <div className="auction-basket__warn-box">
            {t('basketHotWalletOnly')}
          </div>
        )}

        {this.state.savedDraft?.rows?.length > 0 && step === 'edit' && !order.length && (
          <div className="auction-basket__warn-box">
            <strong>{t('basketDraftAvailable')}</strong>
            <span>{t('basketDraftSaved', String(this.state.savedDraft.rows.length), new Date(this.state.savedDraft.savedAt).toLocaleString())}</span>
            <button type="button" className="auction-basket__btn" onClick={this.restoreSavedDraft}>
              {t('basketRestoreDraft')}
            </button>
          </div>
        )}

        {step === 'edit' ? this.renderEdit() : this.renderReview()}

        {!!order.length && step === 'edit' && (
          <div className="auction-basket__footer-actions">
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--secondary"
              onClick={this.refreshStatuses}
              disabled={this.state.checking}
            >
              {this.state.checking ? t('loading') : t('basketRefreshStatus')}
            </button>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--secondary"
              onClick={this.removeNonBidding}
              disabled={this.state.checking}
            >
              {t('basketKeepBiddingOnly')}
            </button>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--secondary"
              onClick={this.applyAmountsToBidding}
            >
              {t('basketApplyAmounts')}
            </button>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--secondary"
              onClick={this.removeEmptyAmountRows}
            >
              {t('basketRemoveEmpty')}
            </button>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--danger"
              onClick={this.onClearBasket}
              disabled={this.state.broadcastUncertain || this.isSubmissionActive() || this._submitRunning}
            >
              {t('basketClear')}
            </button>
            <button type="button" className="auction-basket__btn auction-basket__btn--secondary" onClick={this.copyBasket}>
              {t('basketCopy')}
            </button>
            <button type="button" className="auction-basket__btn auction-basket__btn--secondary" onClick={this.exportBasketCSV}>
              {t('basketExportCSV')}
            </button>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--secondary"
              onClick={() => this.setState({showSplit: !this.state.showSplit})}
            >
              {t('basketSplit')}
            </button>
            <button
              type="button"
              className="auction-basket__btn"
              onClick={this.goReview}
              disabled={!this.canReview() || this.state.checking}
            >
              {t('basketReview')}
            </button>
          </div>
        )}

        {!!order.length && step === 'edit' && this.state.showSplit && this.renderSplitBatches()}
      </div>
    );
  }

  renderEdit() {
    const { t } = this.context;
    const { order, items } = this.props;
    const { singleName, pasteText, showPaste, rowMeta } = this.state;

    return (
      <>
        <section className="auction-basket__panel">
          <div className="auction-basket__panel-header">
            <h3>{t('basketAddNames')}</h3>
            <span>{t('basketLimitLabel', String(order.length), String(AUCTION_BASKET_LIMIT))}</span>
          </div>

          <div className="auction-basket__add-row">
            <input
              className="auction-basket__input"
              placeholder={t('basketNamePlaceholder')}
              value={singleName}
              onChange={(e) => this.setState({ singleName: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && this.onAddSingle()}
            />
            <button type="button" className="auction-basket__btn" onClick={this.onAddSingle}>
              {t('basketAdd')}
            </button>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--secondary"
              onClick={() => this.setState({ showPaste: !showPaste })}
            >
              {t('basketPasteList')}
            </button>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--secondary"
              onClick={() => this.setState({showCompletePaste: !this.state.showCompletePaste})}
            >
              {t('basketPasteComplete')}
            </button>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--secondary"
              onClick={this.onAddFromWatchlist}
            >
              {t('basketAddWatchlist')}
            </button>
          </div>

          {showPaste && (
            <>
              <textarea
                className="auction-basket__textarea"
                placeholder={t('basketPastePlaceholder')}
                value={pasteText}
                onChange={(e) => this.setState({ pasteText: e.target.value })}
              />
              <div className="auction-basket__actions">
                <button type="button" className="auction-basket__btn" onClick={this.onAddPaste}>
                  {t('basketAddPasted')}
                </button>
              </div>
            </>
          )}

          {this.state.showCompletePaste && (
            <div className="auction-basket__complete-import">
              <textarea
                className="auction-basket__textarea"
                placeholder={'name,true_bid,blind\nexample,1.5,2.5'}
                value={this.state.completePasteText}
                onChange={(e) => this.setState({completePasteText: e.target.value})}
              />
              <div className="auction-basket__actions">
                <button
                  type="button"
                  className="auction-basket__btn"
                  onClick={this.previewCompleteBasket}
                  disabled={this.state.importChecking || !this.state.completePasteText.trim()}
                >
                  {this.state.importChecking ? t('basketCheckingAuctions') : t('basketPreviewComplete')}
                </button>
                <button
                  type="button"
                  className="auction-basket__btn auction-basket__btn--secondary"
                  onClick={() => this.setState({showCompletePaste: false, importPreview: []})}
                >
                  {t('cancel')}
                </button>
              </div>
              {!!this.state.importPreview.length && this.renderImportPreview()}
            </div>
          )}
        </section>

        <section className="auction-basket__panel">
          <div className="auction-basket__panel-header">
            <h3>{t('basketContents')}</h3>
            <span>{t('basketAmountsHint')}</span>
          </div>

          <p className="auction-basket__help">
            {t('basketBiddingOnlyHelp')}
          </p>
          <p className="auction-basket__help">
            {t('basketSkipEmptyHelp')}
          </p>

          {!order.length ? (
            <div className="auction-basket__empty">{t('basketEmpty')}</div>
          ) : (
            <div className="auction-basket__table-wrap">
              <table className="auction-basket__table">
                <thead>
                  <tr>
                    <th>{t('domain')}</th>
                    <th className="status">{t('status')}</th>
                    <th className="num">{t('basketTrueBid')}</th>
                    <th className="num">{t('basketBlind')}</th>
                    <th className="num">{t('basketLockup')}</th>
                    <th>{t('timeLeft')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {order.map((name) => {
                    const item = items[name] || {};
                    const meta = rowMeta[name] || {};
                    const bid = Number(item.bidAmount) || 0;
                    const blind = Number(item.blindAmount) || 0;
                    const lockup = bid + blind;
                    const statusClass = meta.error
                      ? 'auction-basket__status--bad'
                      : meta.state === 'BIDDING'
                        ? 'auction-basket__status--ok'
                        : 'auction-basket__status--loading';

                    return (
                      <tr key={name}>
                        <td className="name">
                          <button
                            type="button"
                            className="auction-basket__linkish"
                            onClick={() => this.props.history.push(`/domain/${name}`)}
                          >
                            {name}/
                          </button>
                        </td>
                        <td>
                          <span className={c('auction-basket__status', statusClass)}>
                            {meta.error || meta.state || '…'}
                          </span>
                          {meta.error && (
                            <div className="auction-basket__row-error">{meta.error}</div>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={item.bidAmount}
                            onChange={(e) => this.props.updateBasketItem(name, {
                              bidAmount: sanitizeAmountInput(e.target.value),
                            })}
                            onBlur={() => this.props.updateBasketItem(name, {
                              bidAmount: normalizeAmountInput(item.bidAmount),
                            })}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={item.blindAmount}
                            onChange={(e) => this.props.updateBasketItem(name, {
                              blindAmount: sanitizeAmountInput(e.target.value),
                            })}
                            onBlur={() => this.props.updateBasketItem(name, {
                              blindAmount: normalizeAmountInput(item.blindAmount),
                            })}
                          />
                        </td>
                        <td>{lockup > 0 ? `${lockup.toFixed(2)} HNS` : '—'}</td>
                        <td>{this.formatTime(meta.hoursUntilReveal)}</td>
                        <td>
                          <button
                            type="button"
                            className="auction-basket__linkish"
                            onClick={() => this.props.removeFromBasket(name)}
                          >
                            {t('remove')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
    );
  }

  renderImportPreview() {
    const {t} = this.context;
    const rows = this.state.importPreview;
    const accepted = rows.filter(row => row.errors.length === 0);
    const totalBid = accepted.reduce((sum, row) => sum + Number(row.bidAmount || 0), 0);
    const totalBlind = accepted.reduce((sum, row) => sum + Number(row.blindAmount || 0), 0);
    const totalLockup = accepted.reduce((sum, row) => sum + Number(row.lockupAmount || 0), 0);
    const fee = accepted.length * (FEE_BUFFER_PER_NAME / 1e6);
    const after = (this.props.spendableBalance / 1e6) - totalLockup - fee;

    return (
      <div className="auction-basket__import-preview">
        <div className="auction-basket__summary">
          <div className="auction-basket__stat"><label>{t('basketImportAccepted')}</label><strong>{accepted.length}</strong></div>
          <div className="auction-basket__stat"><label>{t('basketTotalBid')}</label><strong>{totalBid.toFixed(6)} HNS</strong></div>
          <div className="auction-basket__stat"><label>{t('basketTotalBlind')}</label><strong>{totalBlind.toFixed(6)} HNS</strong></div>
          <div className="auction-basket__stat"><label>{t('basketTotalLockup')}</label><strong>{totalLockup.toFixed(6)} HNS</strong></div>
          <div className="auction-basket__stat"><label>{t('basketEstimatedFees')}</label><strong>~{fee.toFixed(4)} HNS</strong></div>
          <div className="auction-basket__stat"><label>{t('basketAfterSubmit')}</label><strong>{after.toFixed(6)} HNS</strong></div>
        </div>
        <div className="auction-basket__table-wrap">
          <table className="auction-basket__table">
            <thead><tr><th>{t('basketImportRow')}</th><th>{t('domain')}</th><th>{t('basketTrueBid')}</th><th>{t('basketBlind')}</th><th>{t('basketLockup')}</th><th>{t('status')}</th><th>{t('timeLeft')}</th><th>{t('basketValidation')}</th></tr></thead>
            <tbody>
              {rows.map(row => (
                <tr key={`${row.rowNumber}-${row.name}`}>
                  <td>{row.rowNumber}</td>
                  <td>{row.name || '—'}</td>
                  <td>{row.bidAmount || '—'}</td>
                  <td>{row.blindAmount || '—'}</td>
                  <td>{row.lockupAmount || '—'}</td>
                  <td>{row.auctionState || '—'}</td>
                  <td>{this.formatTime(row.hoursUntilReveal)}</td>
                  <td className={row.errors.length ? 'auction-basket__row-error' : ''}>
                    {row.errors.length ? row.errors.join(' ') : t('ready')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="auction-basket__actions">
          <button type="button" className="auction-basket__btn" onClick={() => this.applyCompleteBasket('replace')} disabled={!accepted.length}>
            {this.props.order.length ? t('basketReplace') : t('basketImport')}
          </button>
          {!!this.props.order.length && (
            <button type="button" className="auction-basket__btn auction-basket__btn--secondary" onClick={() => this.applyCompleteBasket('add')} disabled={!accepted.length}>
              {t('basketImportNewOnly')}
            </button>
          )}
          <button type="button" className="auction-basket__btn auction-basket__btn--secondary" onClick={() => this.setState({importPreview: []})}>{t('cancel')}</button>
        </div>
      </div>
    );
  }

  renderSplitBatches() {
    const {t} = this.context;
    const batches = splitBasket(this.props.order, this.props.items, this.state.splitSize);
    return (
      <section className="auction-basket__panel">
        <div className="auction-basket__panel-header">
          <h3>{t('basketSplitTitle')}</h3>
          <select value={this.state.splitSize} onChange={event => this.setState({splitSize: Number(event.target.value)})}>
            {[5, 10, 20].map(size => <option key={size} value={size}>{t('basketBatchSize', String(size))}</option>)}
          </select>
        </div>
        <p className="auction-basket__help">{t('basketSplitHelp')}</p>
        {batches.map((rows, index) => (
          <div className="auction-basket__split" key={index}>
            <strong>{t('basketBatchCount', String(index + 1), String(rows.length))}</strong>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--secondary"
              onClick={() => this.copyText(this.csvForRows(rows), t('basketBatchCopied', String(index + 1)))}
            >
              {t('basketCopyBatchCSV')}
            </button>
          </div>
        ))}
      </section>
    );
  }

  renderReview() {
    const { t } = this.context;
    const { items, spendableBalance } = this.props;
    let totals = this.getRowTotals();
    const scope = this.state.transactionScope || this.state.reviewedScope;
    if (scope) {
      const fee = scope.fee === null ? totals.feeBuffer : scope.fee / 1e6;
      totals = {...totals, validCount: scope.rows.length, validNames: scope.rows.map(row => row.name),
        totalBid: scope.totalBid / 1e6, totalBlind: scope.totalBlind / 1e6,
        totalLockup: scope.totalLockup / 1e6, needed: scope.totalLockup / 1e6 + fee};
    }
    const after = (spendableBalance / 1e6) - totals.needed;
    const insufficient = after < 0;

    return (
      <section className="auction-basket__panel">
        <div className="auction-basket__panel-header">
          <h3>{t('basketReviewTitle')}</h3>
          <span>{t('basketReviewHelp')}</span>
        </div>

        {(totals.notBiddingCount > 0 || totals.skippedEmptyCount > 0) && (
          <div className="auction-basket__warn-box">
            {totals.notBiddingCount > 0 && (
              <div>{t('basketScopeReviewRequired')}</div>
            )}
            {totals.skippedEmptyCount > 0 && (
              <div>{t('basketSkipEmptyReview', String(totals.skippedEmptyCount), String(totals.validCount))}</div>
            )}
          </div>
        )}

        <div className="auction-basket__summary">
          <div className="auction-basket__stat">
            <label>{t('basketNamesCount')}</label>
            <strong>{totals.validCount}</strong>
          </div>
          <div className="auction-basket__stat">
            <label>{t('basketTotalBid')}</label>
            <strong>{totals.totalBid.toFixed(6)} HNS</strong>
          </div>
          <div className="auction-basket__stat">
            <label>{t('basketTotalBlind')}</label>
            <strong>{totals.totalBlind.toFixed(6)} HNS</strong>
          </div>
          <div className="auction-basket__stat">
            <label>{t('basketTotalLockup')}</label>
            <strong>{totals.totalLockup.toFixed(6)} HNS</strong>
          </div>
          <div className="auction-basket__stat">
            <label>{t(scope?.fee != null ? 'basketExactFee' : 'basketFeeBuffer')}</label>
            <strong>{scope?.fee != null ? displayBalance(scope.fee) : `~${totals.feeBuffer.toFixed(6)}`} HNS</strong>
            <span>{t(scope?.fee != null ? 'basketOneTransaction' : 'basketFeeBufferHelp')}</span>
          </div>
          <div className="auction-basket__stat">
            <label>{t('spendable')}</label>
            <strong>{displayBalance(spendableBalance || 0, true, 2)}</strong>
          </div>
          <div className="auction-basket__stat">
            <label>{t('basketAfterSubmit')}</label>
            <strong>{after.toFixed(2)} HNS</strong>
            {insufficient && <span>{t('basketInsufficientBalance')}</span>}
          </div>
          <div className="auction-basket__stat">
            <label>{t('basketEarliestDeadline')}</label>
            <strong>{this.formatTime(totals.earliestHours)}</strong>
          </div>
        </div>

        <div className="auction-basket__table-wrap">
          <table className="auction-basket__table">
            <thead>
              <tr>
                <th>{t('domain')}</th>
                <th className="num">{t('basketTrueBid')}</th>
                <th className="num">{t('basketBlind')}</th>
                <th className="num">{t('basketLockup')}</th>
                <th>{t('timeLeft')}</th>
              </tr>
            </thead>
            <tbody>
              {totals.validNames.map((name) => {
                const item = items[name] || {};
                const meta = this.state.rowMeta[name] || {};
                const reviewed = scope?.rows.find(row => row.name === name);
                const bid = reviewed ? reviewed.bid / 1e6 : Number(item.bidAmount) || 0;
                const blind = reviewed ? reviewed.blind / 1e6 : Number(item.blindAmount) || 0;
                return (
                  <tr key={name}>
                    <td className="name">{name}/</td>
                    <td>{bid.toFixed(6)} HNS</td>
                    <td>{blind.toFixed(6)} HNS</td>
                    <td>{(bid + blind).toFixed(6)} HNS</td>
                    <td>{this.formatTime(meta.hoursUntilReveal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="auction-basket__warn-box">
          <strong>{t('basketWarningsTitle')}</strong>
          <ul>
            <li>{t('basketWarningSameTx')}</li>
            <li>{t('basketWarningRevealLater')}</li>
            <li>{t('basketWarningNoBlockGuarantee')}</li>
            <li>{t('basketWarningBiddingOnly')}</li>
            <li>{t('basketImportingHelp')}</li>
          </ul>
        </div>

        <div className="auction-basket__confirm">
          <label className="auction-basket__checkbox">
            <input
              type="checkbox"
              checked={this.state.accepted}
              disabled={this.isSubmissionActive() && this.state.submissionPhase !== 'reviewing'}
              onChange={(e) => this.setState({ accepted: e.target.checked })}
            />
            <span>{t(this.state.submissionPhase === 'reviewing' ? 'basketApproveExactScope' : 'basketAcceptRisks')}</span>
          </label>
        </div>

        {this.state.submissionPhase === 'reviewing' && (
          <div className="auction-basket__submission-status">
            <strong>{t('basketExactReview')}</strong>
            <span>{t('basketExactReviewHelp')}</span>
          </div>
        )}

        {['checking', 'rescanning'].includes(this.state.submissionPhase) && (
          <div className="auction-basket__submission-status">
            <strong>{t('basketPreparingStatus')}</strong>
            <span>{this.state.submissionPhase === 'rescanning' ? t('basketRescanningStatus') : t('basketCheckingStatus')}</span>
          </div>
        )}
        {this.state.submissionPhase === 'building' && (
          <div className="auction-basket__submission-status">
            <strong>{t('basketBuildingStatus')}</strong>
            <span>{t('basketBuildingHelp')}</span>
          </div>
        )}
        {this.state.submissionPhase === 'signing' && (
          <div className="auction-basket__submission-status">
            <strong>{t('basketSigningStatus')}</strong>
            <span>{t('basketSigningHelp')}</span>
          </div>
        )}
        {this.state.submissionPhase === 'broadcasting' && (
          <div className="auction-basket__submission-status">
            <strong>{t('basketBroadcastingStatus')}</strong>
            <span>{t('basketBroadcastingHelp')}</span>
          </div>
        )}
        {this.state.submissionPhase === 'verifying' && (
          <div className="auction-basket__submission-status">
            <strong>{t('basketVerifyingStatus')}</strong>
            <span>{this.state.submissionTxid || t('basketVerifyingHelp')}</span>
          </div>
        )}
        {this.state.submissionPhase === 'failed' && (
          <div className="auction-basket__submission-status auction-basket__submission-status--error">
            <strong>{t('basketFailedStage', this.formatSubmissionStage(this.state.submissionFailedStage))}</strong>
            <span>{this.state.submissionError}</span>
            {!this.state.broadcastUncertain && ['checking', 'rescanning', 'building', 'signing'].includes(this.state.submissionFailedStage) && (
              <span>{t('basketRetrySafe')}</span>
            )}
            {this.state.broadcastUncertain && (
              <span>{t('basketRetryUncertain')}</span>
            )}
            {this.renderSubmissionRows()}
          </div>
        )}

        <div className="auction-basket__footer-actions">
          <button
            type="button"
            className="auction-basket__btn auction-basket__btn--secondary"
            onClick={this.onBackToBasket}
            disabled={['broadcasting', 'verifying'].includes(this.state.submissionPhase)}
          >
            {['checking', 'rescanning', 'building', 'reviewing', 'signing'].includes(this.state.submissionPhase) ? t('basketStopWaiting') : t('basketBack')}
          </button>
          <button
            type="button"
            className="auction-basket__btn"
            onClick={this.state.submissionPhase === 'reviewing' ? this.onConfirmPrepared : this.onSubmit}
            disabled={
              (this.isSubmissionActive() && this.state.submissionPhase !== 'reviewing')
              || !this.state.accepted
              || insufficient
              || !this.isHotWalletCapable()
              || (this.state.submissionPhase === 'failed' && !this.state.retryAllowed)
            }
          >
            {this.state.submissionPhase === 'reviewing' ? t('basketSignAndSubmit') : this.state.submissionPhase === 'failed' && this.state.retryAllowed
              ? t('basketRetrySubmission')
              : this.isSubmissionActive() ? t('submitting') : t('basketPrepareExactReview')}
          </button>
        </div>
      </section>
    );
  }

  renderSubmissionRows() {
    const keys = {submitted: 'basketRowSubmitted', expired: 'basketRowExpired',
      failed: 'basketRowFailed', uncertain: 'basketRetryUncertain'};
    return <ul>{this.state.submissionRows.map(row => (
      <li key={row.name}><strong>{row.name}/</strong>: {this.context.t(keys[row.status])}</li>
    ))}</ul>;
  }
}

export default withRouter(
  connect(
    (state) => ({
      order: state.auctionBasket.order,
      items: state.auctionBasket.items,
      spendableBalance: state.wallet.balance.spendable,
      watchOnly: state.wallet.watchOnly,
      walletType: state.wallet.type,
      walletId: state.wallet.wid,
      basketSubmissionProgress: state.wallet.basketSubmissionProgress,
      network: state.wallet.network || state.node.network,
      height: state.node.chain.height,
      watchingNames: state.watching.names || [],
      names: state.names,
    }),
    (dispatch) => ({
      addNamesToBasket: (names) => dispatch(addNamesToBasket(names)),
      removeFromBasket: (name) => dispatch(removeFromBasket(name)),
      updateBasketItem: (name, patch) => dispatch(updateBasketItem(name, patch)),
      clearBasket: () => dispatch(clearBasket()),
      importBasketRows: (rows, mode) => dispatch(importBasketRows(rows, mode)),
      sendBidMany: (entries, options) => dispatch(nameActions.sendBidMany(entries, options)),
      showError: (msg) => dispatch(showError(msg)),
      showSuccess: (msg) => dispatch(showSuccess(msg)),
    })
  )(AuctionBasket)
);

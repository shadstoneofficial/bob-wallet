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
  AUCTION_BASKET_LIMIT,
} from '../../ducks/auctionBasket';
import * as nameActions from '../../ducks/names';
import { showError, showSuccess } from '../../ducks/notifications';
import { displayBalance, toBaseUnits } from '../../utils/balances';
import { isBidding } from '../../utils/nameHelpers';
import nodeClient from '../../utils/nodeClient';
import { clientStub as aClientStub } from '../../background/analytics/client';
import { I18nContext } from '../../utils/i18n';
import './auction-basket.scss';

const analytics = aClientStub(() => require('electron').ipcRenderer);

// Rough fee buffer: ~0.01 HNS per name in base units for preflight balance check.
const FEE_BUFFER_PER_NAME = 10000;

class AuctionBasket extends Component {
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
    sendBidMany: PropTypes.func.isRequired,
    showError: PropTypes.func.isRequired,
    showSuccess: PropTypes.func.isRequired,
    history: PropTypes.object.isRequired,
  };

  static contextType = I18nContext;

  state = {
    singleName: '',
    pasteText: '',
    showPaste: false,
    step: 'edit', // edit | review
    checking: false,
    submitting: false,
    accepted: false,
    rowMeta: {}, // name -> { state, error, hoursUntilReveal, height, walletHasName }
  };

  componentDidMount() {
    analytics.screenView('Auction Basket');
    if (this.props.order.length) {
      this.refreshStatuses();
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.order !== this.props.order && this.props.order.length) {
      this.refreshStatuses();
    }
  }

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
      this.props.showError(t('basketLimitReached', String(AUCTION_BASKET_LIMIT)));
    } else if (result.added) {
      this.setState({ singleName: '' });
    } else if (result.skipped) {
      this.props.showError(t('basketAlreadyAdded', name));
    }
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
      this.props.showError(t('basketLimitReached', String(AUCTION_BASKET_LIMIT)));
    }
  };

  onAddFromWatchlist = () => {
    const { t } = this.context;
    const names = this.props.watchingNames || [];
    if (!names.length) {
      this.props.showError(t('basketWatchlistEmpty'));
      return;
    }
    const result = this.props.addNamesToBasket(names);
    if (result.added) {
      this.props.showSuccess(t('basketAddedCount', String(result.added)));
    }
    if (result.limited) {
      this.props.showError(t('basketLimitReached', String(AUCTION_BASKET_LIMIT)));
    }
    if (!result.added && result.skipped) {
      this.props.showError(t('basketNothingNew'));
    }
  };

  refreshStatuses = async () => {
    const { order, network } = this.props;
    if (!order.length) {
      this.setState({ rowMeta: {}, checking: false });
      return {};
    }

    this.setState({ checking: true });
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
              ? 'Opening'
              : state === 'REVEAL'
                ? 'In reveal'
                : state === 'CLOSED'
                  ? 'Closed'
                  : 'Not bidding';
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
            error: e.message || 'Lookup failed',
            hoursUntilReveal: null,
            height: null,
            walletHasName: false,
          };
        }
      }));
      this.setState({ rowMeta, checking: false });
      return rowMeta;
    } catch (e) {
      this.setState({ checking: false });
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

  getRowTotals = (rowMetaOverride) => {
    const { order, items } = this.props;
    const rowMeta = rowMetaOverride || this.state.rowMeta;
    let totalBid = 0;
    let totalBlind = 0;
    let totalLockup = 0;
    let validCount = 0;
    let notBiddingCount = 0;
    let badAmountCount = 0;
    let earliestHours = null;
    const validNames = [];

    for (const name of order) {
      const item = items[name] || {};
      const meta = rowMeta[name] || {};
      const bid = Number(item.bidAmount) || 0;
      const blind = Number(item.blindAmount || 0);
      const lockup = bid + blind;
      const amountsOk = this.isAmountOk(item);
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
    // Ready when at least one bidding name has valid amounts.
    // Non-bidding rows are skipped at submit (not blockers).
    return totals.validCount > 0 && totals.badAmountCount === 0;
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
    // Use first bidding row that has amounts as the template, else first row with amounts.
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
      if (meta.state === 'BIDDING' && !meta.error) {
        updateBasketItem(name, {
          bidAmount: template.bidAmount,
          blindAmount: template.blindAmount,
        });
        updated += 1;
      }
    }
    if (updated) {
      this.props.showSuccess(t('basketAppliedAmounts', String(updated)));
    }
  };

  goReview = async () => {
    const { t } = this.context;
    try {
      const rowMeta = await this.refreshStatuses();
      if (!this.canReview(rowMeta)) {
        this.props.showError(t('basketFixRowsBeforeReview'));
        return;
      }
      const totals = this.getRowTotals(rowMeta);
      if (totals.needed * 1e6 > (this.props.spendableBalance || 0)) {
        this.props.showError(t('basketInsufficientBalance'));
      }
      this.setState({ step: 'review', accepted: false });
    } catch (e) {
      this.props.showError(e.message || t('basketFixRowsBeforeReview'));
    }
  };

  onSubmit = async () => {
    const { t } = this.context;
    const {
      order,
      items,
      sendBidMany,
      clearBasket,
      showError,
      showSuccess,
      history,
    } = this.props;
    const { accepted, submitting } = this.state;

    if (submitting) return;
    if (!accepted) {
      showError(t('basketMustAccept'));
      return;
    }
    if (!this.isHotWalletCapable()) {
      showError(t('basketHotWalletOnly'));
      return;
    }

    const rowMeta = await this.refreshStatuses();

    const entries = [];
    for (const name of order) {
      const item = items[name];
      const meta = rowMeta[name] || {};
      if (meta.error || meta.state !== 'BIDDING' || !this.isAmountOk(item)) {
        continue; // skip non-bidding / incomplete rows
      }
      const bid = Number(item.bidAmount) || 0;
      const blind = Number(item.blindAmount || 0);
      entries.push({
        name,
        bid: toBaseUnits(bid),
        lockup: toBaseUnits(bid + blind),
        height: meta.height,
      });
    }

    if (!entries.length) {
      showError(t('basketFixRowsBeforeReview'));
      this.setState({ step: 'edit' });
      return;
    }

    this.setState({ submitting: true });
    try {
      const res = await sendBidMany(entries);
      if (res !== null) {
        showSuccess(t('basketSubmitSuccess', String(entries.length)));
        analytics.track('auction basket bid', { count: entries.length });
        clearBasket();
        this.setState({ step: 'edit', accepted: false, rowMeta: {} });
        history.push('/bids/BIDDING');
      }
    } catch (e) {
      showError(e.message || t('basketSubmitFailed'));
    } finally {
      this.setState({ submitting: false });
    }
  };

  formatTime = (hours) => {
    if (hours == null || !Number.isFinite(hours)) return '—';
    if (hours < 24) {
      const h = Math.floor(hours);
      const m = Math.floor((hours - h) * 60);
      return `~${h}h ${m}m`;
    }
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours - d * 24);
    return `~${d}d ${h}h`;
  };

  render() {
    const { t } = this.context;
    const { order } = this.props;
    const { step } = this.state;

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
              className="auction-basket__btn auction-basket__btn--danger"
              onClick={() => {
                this.props.clearBasket();
                this.setState({ rowMeta: {}, step: 'edit' });
              }}
            >
              {t('basketClear')}
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
        </section>

        <section className="auction-basket__panel">
          <div className="auction-basket__panel-header">
            <h3>{t('basketContents')}</h3>
            <span>{t('basketAmountsHint')}</span>
          </div>

          <p className="auction-basket__help">
            {t('basketBiddingOnlyHelp')}
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
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.bidAmount}
                            onChange={(e) => this.props.updateBasketItem(name, {
                              bidAmount: e.target.value,
                            })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.blindAmount}
                            onChange={(e) => this.props.updateBasketItem(name, {
                              blindAmount: e.target.value,
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

  renderReview() {
    const { t } = this.context;
    const { order, items, spendableBalance } = this.props;
    const totals = this.getRowTotals();
    const after = (spendableBalance / 1e6) - totals.needed;
    const insufficient = after < 0;

    return (
      <section className="auction-basket__panel">
        <div className="auction-basket__panel-header">
          <h3>{t('basketReviewTitle')}</h3>
          <span>{t('basketReviewHelp')}</span>
        </div>

        {totals.notBiddingCount > 0 && (
          <div className="auction-basket__warn-box">
            {t('basketSkipNonBidding', String(totals.notBiddingCount), String(totals.validCount))}
          </div>
        )}

        <div className="auction-basket__summary">
          <div className="auction-basket__stat">
            <label>{t('basketNamesCount')}</label>
            <strong>{totals.validCount}</strong>
          </div>
          <div className="auction-basket__stat">
            <label>{t('basketTotalBid')}</label>
            <strong>{totals.totalBid.toFixed(2)} HNS</strong>
          </div>
          <div className="auction-basket__stat">
            <label>{t('basketTotalBlind')}</label>
            <strong>{totals.totalBlind.toFixed(2)} HNS</strong>
          </div>
          <div className="auction-basket__stat">
            <label>{t('basketTotalLockup')}</label>
            <strong>{totals.totalLockup.toFixed(2)} HNS</strong>
          </div>
          <div className="auction-basket__stat">
            <label>{t('basketFeeBuffer')}</label>
            <strong>~{totals.feeBuffer.toFixed(4)} HNS</strong>
            <span>{t('basketFeeBufferHelp')}</span>
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
                const bid = Number(item.bidAmount) || 0;
                const blind = Number(item.blindAmount) || 0;
                return (
                  <tr key={name}>
                    <td className="name">{name}/</td>
                    <td>{bid.toFixed(2)} HNS</td>
                    <td>{blind.toFixed(2)} HNS</td>
                    <td>{(bid + blind).toFixed(2)} HNS</td>
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
              onChange={(e) => this.setState({ accepted: e.target.checked })}
            />
            <span>{t('basketAcceptRisks')}</span>
          </label>
        </div>

        <div className="auction-basket__footer-actions">
          <button
            type="button"
            className="auction-basket__btn auction-basket__btn--secondary"
            onClick={() => this.setState({ step: 'edit' })}
            disabled={this.state.submitting}
          >
            {t('back')}
          </button>
          <button
            type="button"
            className="auction-basket__btn"
            onClick={this.onSubmit}
            disabled={
              this.state.submitting
              || !this.state.accepted
              || insufficient
              || !this.isHotWalletCapable()
            }
          >
            {this.state.submitting ? t('submitting') : t('basketSubmit')}
          </button>
        </div>
      </section>
    );
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
      sendBidMany: (entries) => dispatch(nameActions.sendBidMany(entries)),
      showError: (msg) => dispatch(showError(msg)),
      showSuccess: (msg) => dispatch(showSuccess(msg)),
    })
  )(AuctionBasket)
);

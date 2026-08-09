import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import c from 'classnames';
import { verifyName } from 'hsd/lib/covenants/rules';
import {
  addNamesToOpenBasket,
  removeFromOpenBasket,
  clearOpenBasket,
  OPEN_BASKET_LIMIT,
} from '../../ducks/openBasket';
import * as nameActions from '../../ducks/names';
import { showError, showSuccess } from '../../ducks/notifications';
import { isAvailable, isBidding, isOpening, isReserved, isLockedUp, isClosed } from '../../utils/nameHelpers';
import nodeClient from '../../utils/nodeClient';
import { clientStub as aClientStub } from '../../background/analytics/client';
import { I18nContext } from '../../utils/i18n';
import '../AuctionBasket/auction-basket.scss';

const analytics = aClientStub(() => require('electron').ipcRenderer);

/**
 * Whether this name can receive a createopen right now.
 * Fail-closed: only names with no live name state (or fully expired) are openable.
 * Registered/owned names (e.g. videotapes/) must never show "Ready to open".
 */
function classifyOpenEligibility(result, height, pendingOp) {
  const start = result?.start;
  const info = result?.info;
  const h = height || 0;
  const domain = {
    start,
    info,
    pendingOperation: pendingOp,
  };

  if (!start) {
    return { status: 'UNKNOWN', canOpen: false, error: 'Unknown name' };
  }

  if (start.reserved || isReserved(domain)) {
    return { status: 'RESERVED', canOpen: false, error: 'Reserved' };
  }

  // Locked only applies when there is no name state yet.
  if ((start.locked || isLockedUp(domain)) && !info) {
    return { status: 'LOCKED', canOpen: false, error: 'Locked' };
  }

  if (start.start > h) {
    return { status: 'NOT_YET', canOpen: false, error: 'Not yet claimable' };
  }

  if (pendingOp === 'OPEN') {
    return { status: 'PENDING_OPEN', canOpen: false, error: 'Open pending in wallet' };
  }

  // Any non-expired name state means OPEN is invalid (opening/bidding/reveal/registered).
  if (info) {
    const state = info.state;
    const expired = !!info.expired;

    if (!expired) {
      if (state === 'OPENING' || isOpening(domain)) {
        return { status: 'OPENING', canOpen: false, error: 'Already opening' };
      }
      if (state === 'BIDDING' || isBidding(domain)) {
        return {
          status: 'BIDDING',
          canOpen: false,
          error: 'Already bidding — use Auction Basket',
        };
      }
      if (state === 'REVEAL') {
        return { status: 'REVEAL', canOpen: false, error: 'In reveal' };
      }
      // CLOSED / registered / owned — common case for stale open lists
      if (state === 'CLOSED' || isClosed(domain) || info.owner) {
        return {
          status: 'OWNED',
          canOpen: false,
          error: 'Registered / owned (not available)',
        };
      }
      // Unknown non-expired state: do not allow OPEN
      return {
        status: state || 'ACTIVE',
        canOpen: false,
        error: `Not available${state ? ` (${state})` : ''}`,
      };
    }

    // Fully expired: may be re-opened
    return { status: 'EXPIRED', canOpen: true, error: '' };
  }

  // No name state on chain → free to OPEN
  if (isAvailable(domain) || !info) {
    return { status: 'AVAILABLE', canOpen: true, error: '' };
  }

  return { status: 'UNAVAILABLE', canOpen: false, error: 'Not available' };
}

class OpenBasket extends Component {
  static propTypes = {
    order: PropTypes.array.isRequired,
    spendableBalance: PropTypes.number,
    watchOnly: PropTypes.bool,
    walletType: PropTypes.string,
    height: PropTypes.number,
    watchingNames: PropTypes.array,
    names: PropTypes.object,
    addNamesToOpenBasket: PropTypes.func.isRequired,
    removeFromOpenBasket: PropTypes.func.isRequired,
    clearOpenBasket: PropTypes.func.isRequired,
    sendOpenMany: PropTypes.func.isRequired,
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
    rowMeta: {}, // name -> { status, canOpen, error }
  };

  componentDidMount() {
    analytics.screenView('Open Basket');
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

  notifyBasketFull = () => {
    const { t } = this.context;
    this.props.showError(
      t('openBasketLimitHelp', String(this.props.order.length), String(OPEN_BASKET_LIMIT))
    );
  };

  onAddSingle = () => {
    const { t } = this.context;
    const name = this.state.singleName.trim().toLowerCase().replace(/\/$/, '');
    if (!name) return;

    if (!verifyName(name)) {
      this.props.showError(t('basketInvalidName', name));
      return;
    }

    const result = this.props.addNamesToOpenBasket([name]);
    if (result.limited) {
      this.notifyBasketFull();
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

    const result = this.props.addNamesToOpenBasket(valid);
    if (result.added) {
      this.setState({ pasteText: '', showPaste: false });
      this.props.showSuccess(t('basketAddedCount', String(result.added)));
    }
    if (result.limited) {
      this.notifyBasketFull();
    }
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
      const openable = [];
      for (const name of names) {
        try {
          const info = await nodeClient.getNameInfo(name);
          const classified = classifyOpenEligibility(
            info,
            this.props.height,
            this.props.names?.[name]?.pendingOperation
          );
          if (classified.canOpen) {
            openable.push(name);
          }
        } catch (e) {
          // skip
        }
      }

      if (!openable.length) {
        this.props.showError(t('openBasketWatchlistNone'));
        return;
      }

      const result = this.props.addNamesToOpenBasket(openable);
      if (result.added) {
        this.props.showSuccess(
          t('openBasketAddedOpenable', String(result.added), String(openable.length))
        );
        await this.refreshStatuses();
      }
      if (result.limited && !result.added) {
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
    const { order, height, names } = this.props;
    if (!order.length) {
      this.setState({ rowMeta: {}, checking: false });
      return {};
    }

    this.setState({ checking: true });
    const rowMeta = {};

    try {
      await Promise.all(order.map(async (name) => {
        try {
          const info = await nodeClient.getNameInfo(name);
          rowMeta[name] = classifyOpenEligibility(
            info,
            height,
            names?.[name]?.pendingOperation
          );
        } catch (e) {
          rowMeta[name] = {
            status: 'ERROR',
            canOpen: false,
            error: e.message || 'Lookup failed',
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

  getOpenableNames = (rowMetaOverride) => {
    const { order } = this.props;
    const rowMeta = rowMetaOverride || this.state.rowMeta;
    return order.filter((name) => rowMeta[name]?.canOpen);
  };

  canReview = (rowMetaOverride) => {
    if (!this.isHotWalletCapable()) return false;
    return this.getOpenableNames(rowMetaOverride).length > 0;
  };

  removeNotOpenable = () => {
    const { order, removeFromOpenBasket } = this.props;
    const { rowMeta } = this.state;
    let removed = 0;
    for (const name of [...order]) {
      if (!rowMeta[name]?.canOpen) {
        removeFromOpenBasket(name);
        removed += 1;
      }
    }
    if (removed) {
      this.props.showSuccess(this.context.t('openBasketRemovedBlocked', String(removed)));
    } else {
      this.props.showError(this.context.t('basketNothingNew'));
    }
  };

  goReview = async () => {
    const { t } = this.context;
    try {
      const rowMeta = await this.refreshStatuses();
      const openable = this.getOpenableNames(rowMeta);
      const blocked = this.props.order.length - openable.length;
      if (!openable.length) {
        this.props.showError(t('openBasketNothingToOpen'));
        return;
      }
      if (blocked > 0) {
        this.props.showSuccess(
          t('openBasketPreflightDropped', String(blocked), String(openable.length))
        );
      }
      this.setState({ step: 'review', accepted: false });
    } catch (e) {
      this.props.showError(e.message || t('openBasketNothingToOpen'));
    }
  };

  onSubmit = async () => {
    const { t } = this.context;
    const {
      sendOpenMany,
      clearOpenBasket,
      removeFromOpenBasket,
      showError,
      showSuccess,
      history,
    } = this.props;
    const { accepted, submitting } = this.state;

    if (submitting) return;
    if (!accepted) {
      showError(t('openBasketMustAccept'));
      return;
    }
    if (!this.isHotWalletCapable()) {
      showError(t('openBasketHotWalletOnly'));
      return;
    }

    // Always re-verify on-chain status immediately before signing.
    const rowMeta = await this.refreshStatuses();
    let names = this.getOpenableNames(rowMeta);

    if (!names.length) {
      showError(t('openBasketNothingToOpen'));
      this.setState({ step: 'edit' });
      return;
    }

    const blocked = this.props.order.filter((n) => !names.includes(n));
    if (blocked.length) {
      // Drop names that failed the fresh check so the UI matches what we submit.
      for (const name of blocked) {
        removeFromOpenBasket(name);
      }
      showError(
        t('openBasketRemovedBeforeSubmit', String(blocked.length), blocked.map((n) => `${n}/`).join(', '))
      );
      if (!names.length) {
        this.setState({ step: 'edit' });
        return;
      }
    }

    this.setState({ submitting: true });
    try {
      const res = await sendOpenMany(names);
      if (res !== null) {
        showSuccess(t('openBasketSubmitSuccess', String(names.length)));
        analytics.track('open basket', { count: names.length });
        clearOpenBasket();
        this.setState({ step: 'edit', accepted: false, rowMeta: {} });
        history.push('/watching');
      }
    } catch (e) {
      const msg = e.message || t('openBasketSubmitFailed');
      // HSD: "Name is not available: videotapes."
      const match = msg.match(/Name is not available:\s*([a-z0-9-]+)/i);
      if (match) {
        const bad = match[1].toLowerCase();
        removeFromOpenBasket(bad);
        this.setState((state) => ({
          step: 'edit',
          rowMeta: {
            ...state.rowMeta,
            [bad]: {
              status: 'OWNED',
              canOpen: false,
              error: 'Registered / owned (not available)',
            },
          },
        }));
        showError(
          t('openBasketChainRejected', `${bad}/`, msg)
        );
      } else {
        showError(msg);
      }
    } finally {
      this.setState({ submitting: false });
    }
  };

  render() {
    const { t } = this.context;
    const { order } = this.props;
    const { step } = this.state;

    return (
      <div className="auction-basket">
        <div className="auction-basket__intro">
          <h2>{t('openBasketTitle')}</h2>
          <p>{t('openBasketSubtitle')}</p>
        </div>

        {!this.isHotWalletCapable() && (
          <div className="auction-basket__warn-box">
            {t('openBasketHotWalletOnly')}
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
              onClick={this.removeNotOpenable}
              disabled={this.state.checking}
            >
              {t('openBasketKeepOpenable')}
            </button>
            <button
              type="button"
              className="auction-basket__btn auction-basket__btn--danger"
              onClick={() => {
                this.props.clearOpenBasket();
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
              {t('openBasketReview')}
            </button>
          </div>
        )}
      </div>
    );
  }

  renderEdit() {
    const { t } = this.context;
    const { order } = this.props;
    const { singleName, pasteText, showPaste, rowMeta } = this.state;

    return (
      <>
        <section className="auction-basket__panel">
          <div className="auction-basket__panel-header">
            <h3>{t('basketAddNames')}</h3>
            <span>{t('basketLimitLabel', String(order.length), String(OPEN_BASKET_LIMIT))}</span>
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
              disabled={this.state.checking}
            >
              {t('openBasketAddWatchlist')}
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
            <h3>{t('openBasketContents')}</h3>
            <span>{t('openBasketContentsHelp')}</span>
          </div>

          <p className="auction-basket__help">
            {t('openBasketOpenOnlyHelp')}
          </p>

          {!order.length ? (
            <div className="auction-basket__empty">{t('openBasketEmpty')}</div>
          ) : (
            <div className="auction-basket__table-wrap">
              <table className="auction-basket__table">
                <thead>
                  <tr>
                    <th>{t('domain')}</th>
                    <th className="status">{t('status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {order.map((name) => {
                    const meta = rowMeta[name] || {};
                    const statusClass = meta.canOpen
                      ? 'auction-basket__status--ok'
                      : meta.error
                        ? 'auction-basket__status--bad'
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
                            {meta.canOpen
                              ? t('openBasketStatusReady')
                              : (meta.error || meta.status || '…')}
                          </span>
                          {meta.error && !meta.canOpen && (
                            <div className="auction-basket__row-error">{meta.error}</div>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="auction-basket__linkish"
                            onClick={() => this.props.removeFromOpenBasket(name)}
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
    const openable = this.getOpenableNames();
    const skipped = this.props.order.length - openable.length;

    return (
      <section className="auction-basket__panel">
        <div className="auction-basket__panel-header">
          <h3>{t('openBasketReviewTitle')}</h3>
          <span>{t('openBasketReviewHelp')}</span>
        </div>

        {skipped > 0 && (
          <div className="auction-basket__warn-box">
            {t('openBasketSkipBlocked', String(skipped), String(openable.length))}
          </div>
        )}

        <div className="auction-basket__summary">
          <div className="auction-basket__stat">
            <label>{t('openBasketNamesToOpen')}</label>
            <strong>{openable.length}</strong>
          </div>
        </div>

        <div className="auction-basket__table-wrap">
          <table className="auction-basket__table">
            <thead>
              <tr>
                <th>{t('domain')}</th>
                <th>{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {openable.map((name) => (
                <tr key={name}>
                  <td className="name">{name}/</td>
                  <td>
                    <span className="auction-basket__status auction-basket__status--ok">
                      {t('openBasketStatusReady')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="auction-basket__warn-box">
          <strong>{t('basketWarningsTitle')}</strong>
          <ul>
            <li>{t('openBasketWarningOpenOnly')}</li>
            <li>{t('openBasketWarningWaitBidding')}</li>
            <li>{t('openBasketWarningThenBid')}</li>
            <li>{t('basketWarningSameTx')}</li>
          </ul>
        </div>

        <div className="auction-basket__confirm">
          <label className="auction-basket__checkbox">
            <input
              type="checkbox"
              checked={this.state.accepted}
              onChange={(e) => this.setState({ accepted: e.target.checked })}
            />
            <span>{t('openBasketAcceptRisks')}</span>
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
              || !this.isHotWalletCapable()
              || !openable.length
            }
          >
            {this.state.submitting ? t('submitting') : t('openBasketSubmit')}
          </button>
        </div>
      </section>
    );
  }
}

export default withRouter(
  connect(
    (state) => ({
      order: state.openBasket.order,
      spendableBalance: state.wallet.balance.spendable,
      watchOnly: state.wallet.watchOnly,
      walletType: state.wallet.type,
      height: state.node.chain.height,
      watchingNames: state.watching.names || [],
      names: state.names,
    }),
    (dispatch) => ({
      addNamesToOpenBasket: (names) => dispatch(addNamesToOpenBasket(names)),
      removeFromOpenBasket: (name) => dispatch(removeFromOpenBasket(name)),
      clearOpenBasket: () => dispatch(clearOpenBasket()),
      sendOpenMany: (names) => dispatch(nameActions.sendOpenMany(names)),
      showError: (msg) => dispatch(showError(msg)),
      showSuccess: (msg) => dispatch(showSuccess(msg)),
    })
  )(OpenBasket)
);

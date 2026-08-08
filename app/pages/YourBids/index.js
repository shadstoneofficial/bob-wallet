import React, { Component } from 'react';
import { withRouter } from 'react-router';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import BidStatus from './BidStatus';
import BidTimeLeft from './BidTimeLeft';
import BidAction from './BidAction';
import { HeaderItem, HeaderRow, Table, TableItem, TableRow } from '../../components/Table';
import BidSearchInput from '../../components/BidSearchInput';
import { displayBalance } from '../../utils/balances';
import { formatName } from '../../utils/nameHelpers';
import Fuse from '../../vendor/fuse';
import './your-bids.scss';
import { clientStub as aClientStub } from '../../background/analytics/client';
import * as bidsActions from "../../ducks/bids";
import Dropdown from "../../components/Dropdown";
import {getPageIndices} from "../../utils/pageable";
import c from "classnames";
import * as nameActions from "../../ducks/names";
import * as notifActions from "../../ducks/notifications";
import dbClient from "../../utils/dbClient";
import {BIDS_FILTER_NEED_REVEAL, NAME_STATES} from "../../constants/names";
import {I18nContext} from "../../utils/i18n";

const analytics = aClientStub(() => require('electron').ipcRenderer);

const ITEM_PER_DROPDOWN = [
  { label: '5', value: 5 },
  { label: '10', value: 10 },
  { label: '20', value: 20 },
  { label: '50', value: 50 },
];

const YOUR_BIDS_ITEMS_PER_PAGE_KEY = 'your-bids-items-per-page';

class YourBids extends Component {
  static propTypes = {
    order: PropTypes.array.isRequired,
    map: PropTypes.object.isRequired,
    filter: PropTypes.object.isRequired,
    history: PropTypes.object.isRequired,
    match: PropTypes.object.isRequired,
    getYourBids: PropTypes.func.isRequired,
    sendRedeemAll: PropTypes.func.isRequired,
    sendRevealAll: PropTypes.func.isRequired,
    sendRevealMany: PropTypes.func.isRequired,
    showError: PropTypes.func.isRequired,
    showSuccess: PropTypes.func.isRequired,
  };

  static contextType = I18nContext;

  state = {
    isShowingNameClaimForPayment: false,
    activeFilter: '',
    currentPageIndex: 0,
    itemsPerPage: 10,
    query: '',
    loading: true,
    selectedIds: {},
    isRevealingSelected: false,
  };

  async componentDidMount() {
    analytics.screenView('Your Bids');
    this.props.getYourBids()
      .then(() => this.setState({ loading: false }));
    const itemsPerPage = await dbClient.get(YOUR_BIDS_ITEMS_PER_PAGE_KEY);
    this.setState({
      itemsPerPage: itemsPerPage || 10,
      activeFilter: this.props.match.params.filterType || '',
    });
  }

  componentDidUpdate(prevProps) {
    const nextFilter = this.props.match.params.filterType || '';
    const prevFilter = prevProps.match.params.filterType || '';
    if (nextFilter !== prevFilter && nextFilter !== this.state.activeFilter) {
      this.setState({
        activeFilter: nextFilter,
        currentPageIndex: 0,
        selectedIds: {},
      });
      this.fuse = null;
    }
  }

  handleOnChange = async e => {
    this.setState({ query: e.target.value });
  };

  onRegisterAll = async () => {
    const {
      showError,
      showSuccess,
      sendRegisterAll,
    } = this.props;

    try {
      const res = await sendRegisterAll();
      if (res !== null) {
        if (res && res.txid) {
          const txLabel = res.txids && res.txids.length > 1 ? 'Txs' : 'Tx';
          showSuccess(
            `Register transaction submitted for ${res.names.join(', ')}. ` +
            `${txLabel}: ${res.txid}. It will show as registered after it confirms on-chain.`
          );
        } else {
          showSuccess(this.context.t('registerSuccess'));
        }
      }
    } catch (e) {
      showError(e.message)
    }
  };

  onRedeemAll = async () => {
    const {
      showError,
      showSuccess,
      sendRedeemAll,
    } = this.props;

    try {
      const res = await sendRedeemAll();
      if (res !== null) {
        showSuccess(this.context.t('redeemSuccess'));
      }
    } catch (e) {
      showError(e.message)
    }
  };

  onRevealAll = async () => {
    const {
      showError,
      showSuccess,
      sendRevealAll,
    } = this.props;

    try {
      const res = await sendRevealAll();
      if (res !== null) {
        showSuccess(this.context.t('revealSuccess'));
      }
    } catch (e) {
      showError(e.message)
    }
  };

  onRevealSelected = async () => {
    const {t} = this.context;
    const {
      showError,
      showSuccess,
      sendRevealMany,
      getYourBids,
      map,
    } = this.props;
    const {selectedIds, isRevealingSelected} = this.state;

    if (isRevealingSelected) {
      return;
    }

    const names = [...new Set(
      Object.keys(selectedIds)
        .filter(id => selectedIds[id])
        .map(id => map[id]?.name)
        .filter(Boolean)
    )];

    if (!names.length) {
      return;
    }

    this.setState({ isRevealingSelected: true });

    try {
      const res = await sendRevealMany(names);
      if (res !== null) {
        showSuccess(t('revealSelectedSuccess', String(names.length)));
        this.setState({ selectedIds: {} });
        await getYourBids();
      }
    } catch (e) {
      showError(e.message);
    } finally {
      this.setState({ isRevealingSelected: false });
    }
  };

  isNeedRevealFilter = () => this.state.activeFilter === BIDS_FILTER_NEED_REVEAL;

  getBidId = (bid) => {
    if (!bid) return null;
    if (bid.prevout?.hash != null && bid.prevout?.index != null) {
      return `${bid.prevout.hash}${bid.prevout.index}`;
    }
    // Fallback for already-stringified id keys used in the filter map.
    return null;
  };

  getCurrentBids() {
    const {order, map, filter} = this.props;
    const {activeFilter} = this.state;

    if (activeFilter) {
      return (filter[activeFilter] || []).map(id => map[id]).filter(Boolean);
    }
    return order?.map(id => map[id]).filter(Boolean) || [];
  }

  setFilter = (value) => {
    this.setState({
      activeFilter: value,
      currentPageIndex: 0,
      selectedIds: {},
      query: '',
    });
    this.fuse = null;
    const path = value ? `/bids/${value}` : '/bids';
    if (this.props.history.location.pathname !== path) {
      this.props.history.replace(path);
    }
  };

  toggleSelected = (bidId, e) => {
    if (e) {
      e.stopPropagation();
    }
    if (!bidId) return;
    this.setState(state => ({
      selectedIds: {
        ...state.selectedIds,
        [bidId]: !state.selectedIds[bidId],
      },
    }));
  };

  toggleSelectAllVisible = (visibleBids, e) => {
    if (e) {
      e.stopPropagation();
    }
    const ids = visibleBids
      .map(bid => {
        // Prefer filter list ids from map keys
        const fromProps = Object.keys(this.props.map).find(id => this.props.map[id] === bid);
        return fromProps || this.getBidId(bid);
      })
      .filter(Boolean);

    const allSelected = ids.length > 0 && ids.every(id => this.state.selectedIds[id]);
    const next = { ...this.state.selectedIds };
    ids.forEach(id => {
      if (allSelected) {
        delete next[id];
      } else {
        next[id] = true;
      }
    });
    this.setState({ selectedIds: next });
  };

  getSelectedCount = () =>
    Object.keys(this.state.selectedIds).filter(id => this.state.selectedIds[id]).length;

  render() {
    const {t} = this.context;
    const selectedCount = this.getSelectedCount();
    const needRevealMode = this.isNeedRevealFilter();

    return (
      <div className="bids">
        <div className="bids__top">
          <BidSearchInput
            className="bids__search"
            onChange={this.handleOnChange}
            value={this.state.query}
          />
          <div className="bids__top__actions">
            {needRevealMode && selectedCount > 0 && (
              <button
                className="bids__top__btn bids__top__btn--secondary"
                onClick={this.onRevealSelected}
                disabled={this.state.isRevealingSelected}
              >
                {this.state.isRevealingSelected
                  ? t('submitting')
                  : t('revealSelected', String(selectedCount))}
              </button>
            )}
            <button
              className="bids__top__btn"
              onClick={this.onRevealAll}
            >
              {t('revealAll')}
            </button>
            <button
              className="bids__top__btn"
              onClick={this.onRedeemAll}
            >
              {t('redeemAll')}
            </button>
            <button
              className="bids__top__btn"
              onClick={this.onRegisterAll}
            >
              {t('registerAll')}
            </button>
          </div>
        </div>
        <div className="bids__filters">
          {this.renderFilter(t('all'), '')}
          {this.renderFilter(t('bidding'), NAME_STATES.BIDDING)}
          {this.renderFilter(t('reveal'), NAME_STATES.REVEAL)}
          {this.renderFilter(t('awaitingReveal'), BIDS_FILTER_NEED_REVEAL)}
          {this.renderFilter(t('closed'), NAME_STATES.CLOSED)}
        </div>
        {needRevealMode && (
          <div className="bids__hint">
            {t('awaitingRevealHint')}
          </div>
        )}
        <Table className={c('bids-table', { 'bids-table--selectable': needRevealMode })}>
          <Header
            selectable={needRevealMode}
            allSelected={false}
            onToggleAll={(e) => {
              const yourBids = this.getCurrentBids();
              this.toggleSelectAllVisible(yourBids, e);
            }}
          />
          {this.renderRows()}
          {this.renderControls()}
        </Table>
      </div>
    );
  }

  renderFilter = (label, value) => {
    const {activeFilter} = this.state;
    const { filter, order } = this.props;
    const count = value
      ? (filter[value] || []).length
      : order.length;

    return (
      <div
        className={c('bids__filter', {
          'bids__filter--active': activeFilter === value,
          'bids__filter--urgent': value === BIDS_FILTER_NEED_REVEAL && count > 0,
        })}
        onClick={() => this.setFilter(value)}
      >
        {`${label} (${count})`}
      </div>
    )
  };

  renderGoTo() {
    const { currentPageIndex, itemsPerPage } = this.state;
    const {t} = this.context;
    const yourBids = this.getCurrentBids();
    const totalPages = Math.ceil(yourBids.length / itemsPerPage);
    return (
      <div className="domain-manager__page-control__dropdowns">
        <div className="domain-manager__go-to">
          <div className="domain-manager__go-to__text">{t('itemsPerPage')}:</div>
          <Dropdown
            className="domain-manager__go-to__dropdown transactions__items-per__dropdown"
            items={ITEM_PER_DROPDOWN}
            onChange={async itemsPerPage => {
              await dbClient.put(YOUR_BIDS_ITEMS_PER_PAGE_KEY, itemsPerPage);
              this.setState({
                itemsPerPage,
                currentPageIndex: 0,
              })
            }}
            currentIndex={ITEM_PER_DROPDOWN.findIndex(({ value }) => value === this.state.itemsPerPage)}
          />
        </div>
        <div className="domain-manager__go-to">
          <div className="domain-manager__go-to__text">{t('page')}</div>
          <Dropdown
            className="domain-manager__go-to__dropdown"
            items={Array(totalPages).fill(0).map((_, i) => ({ label: `${i + 1}` }))}
            onChange={currentPageIndex => this.setState({ currentPageIndex })}
            currentIndex={currentPageIndex}
          />
          <div className="domain-manager__go-to__total">of {totalPages}</div>
        </div>
      </div>
    )
  }

  renderControls() {
    const {
      currentPageIndex,
      itemsPerPage,
    } = this.state;

    const yourBids = this.getCurrentBids();

    const totalPages = Math.ceil(yourBids.length / itemsPerPage);
    const pageIndices = getPageIndices(yourBids, itemsPerPage, currentPageIndex);

    return (
      <div className="domain-manager__page-control">
        <div className="domain-manager__page-control__numbers">
          <div
            className="domain-manager__page-control__start"
            onClick={() => this.setState({
              currentPageIndex: Math.max(currentPageIndex - 1, 0),
            })}
          />
          {pageIndices.map((pageIndex, i) => {
            if (pageIndex === '...') {
              return (
                <div key={`${pageIndex}-${i}`} className="domain-manager__page-control__ellipsis">...</div>
              );
            }

            return (
              <div
                key={`${pageIndex}-${i}`}
                className={c('domain-manager__page-control__page', {
                  'domain-manager__page-control__page--active': currentPageIndex === pageIndex,
                })}
                onClick={() => this.setState({ currentPageIndex: pageIndex })}
              >
                {pageIndex + 1}
              </div>
            )
          })}
          <div
            className="domain-manager__page-control__end"
            onClick={() => this.setState({
              currentPageIndex: Math.min(currentPageIndex + 1, totalPages - 1),
            })}
          />
        </div>
        {this.renderGoTo()}
      </div>
    )
  }

  findBidId = (bid) => {
    if (!bid) return null;
    const { map } = this.props;
    for (const id of Object.keys(map)) {
      if (map[id] === bid) {
        return id;
      }
    }
    if (bid.prevout) {
      const hash = typeof bid.prevout.hash === 'string'
        ? bid.prevout.hash
        : bid.prevout.hash?.toString?.('hex');
      if (hash != null && bid.prevout.index != null) {
        return `${hash}${bid.prevout.index}`;
      }
    }
    return null;
  };

  renderRows() {
    const { history } = this.props;
    const {
      query,
      currentPageIndex: s,
      itemsPerPage: n,
      loading,
      selectedIds,
    } = this.state;
    const needRevealMode = this.isNeedRevealFilter();

    if (loading) {
      return <LoadingResult />;
    }

    const yourBids = this.getCurrentBids();

    if (!yourBids.length) {
      return <EmptyResult />;
    }

    if (!this.fuse || this._fuseBids !== yourBids) {
      this.fuse = new Fuse(yourBids, {
        keys: ['name'],
        threshold: .4,
      });
      this._fuseBids = yourBids;
    }

    const bids = query ? this.fuse.search(query) : yourBids;

    if (!bids.length) {
      return <EmptyResult />;
    }

    const start = s * n;
    const end = start + n;

    return bids.slice(start, end).map((bid, i) => {
      const bidId = this.findBidId(bid);
      const checked = !!(bidId && selectedIds[bidId]);

      return (
        <TableRow
          key={`${bid.name}-${bidId || i}`}
          onClick={() => history.push(`/domain/${bid.name}`)}
        >
          {needRevealMode && (
            <TableItem>
              <input
                type="checkbox"
                className="bids-table__checkbox"
                checked={checked}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => this.toggleSelected(bidId, e)}
              />
            </TableItem>
          )}
          <TableItem><BidStatus name={bid.name} /></TableItem>
          <TableItem>{formatName(bid.name)}</TableItem>
          <TableItem><BidTimeLeft name={bid.name} /></TableItem>
          <TableItem>{`${+displayBalance(bid.value)} HNS`}</TableItem>
          <TableItem><BidAction name={bid.name} /></TableItem>
        </TableRow>
      );
    });
  }
}

export default withRouter(
  connect(
    state => ({
      order: state.bids.order,
      map: state.bids.map,
      filter: state.bids.filter,
    }),
    dispatch => ({
      getYourBids: () => dispatch(bidsActions.getYourBids()),
      sendRedeemAll: () => dispatch(nameActions.sendRedeemAll()),
      sendRevealAll: () => dispatch(nameActions.sendRevealAll()),
      sendRevealMany: (names) => dispatch(nameActions.sendRevealMany(names)),
      sendRegisterAll: () => dispatch(nameActions.sendRegisterAll()),
      showError: (message) => dispatch(notifActions.showError(message)),
      showSuccess: (message) => dispatch(notifActions.showSuccess(message)),
    })
  )(YourBids)
);

class Header extends Component {
  static propTypes = {
    selectable: PropTypes.bool,
    onToggleAll: PropTypes.func,
  };

  static contextType = I18nContext;

  render() {
    const {t} = this.context;
    const {selectable, onToggleAll} = this.props;
    return (
      <HeaderRow>
        {selectable && (
          <HeaderItem>
            <input
              type="checkbox"
              className="bids-table__checkbox"
              title={t('selectAll')}
              onClick={onToggleAll}
              onChange={onToggleAll}
            />
          </HeaderItem>
        )}
        <HeaderItem>
          <div>{t('status')}</div>
        </HeaderItem>
        <HeaderItem>{t('domain')}</HeaderItem>
        <HeaderItem>{t('timeLeft')}</HeaderItem>
        <HeaderItem>{t('yourBid')}</HeaderItem>
        <HeaderItem />
      </HeaderRow>
    )
  }

}

class EmptyResult extends Component {
  static contextType = I18nContext;

  render() {
    return (
      <TableRow className="bids-table__empty-row">
        {this.context.t('yourBidsEmpty')}
      </TableRow>
    );
  }

}


class LoadingResult extends Component {
  static contextType = I18nContext;

  render() {
    return (
      <TableRow className="bids-table__empty-row">
        {this.context.t('loading')}
      </TableRow>
    );
  }

}

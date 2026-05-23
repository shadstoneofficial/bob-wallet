import React, { Component } from 'react';
import { withRouter } from 'react-router';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import * as myDomainsActions from '../../ducks/myDomains';
import { formatName } from '../../utils/nameHelpers';
import './domain-manager.scss';
import { clientStub as aClientStub } from '../../background/analytics/client';
import fs from 'fs';
import ClaimNameForPayment from './ClaimNameForPayment';
import {HeaderItem, HeaderRow, Table, TableItem, TableRow} from "../../components/Table";
import Blocktime from "../../components/Blocktime";
import BidSearchInput from "../../components/BidSearchInput";
import {displayBalance} from "../../utils/balances";
import {getPageIndices} from "../../utils/pageable";
import c from "classnames";
import Dropdown from "../../components/Dropdown";
import BulkTransfer from "./BulkTransfer";
import * as networks from "hsd/lib/protocol/networks";
import {finalizeAll} from "../../ducks/names";
import {showError, showSuccess} from "../../ducks/notifications";
import dbClient from "../../utils/dbClient";
import BulkFinalizeWarningModal from "./BulkFinalizeWarningModal";
import {I18nContext} from "../../utils/i18n";
import {getExchangeListings} from "../../ducks/exchange";
import {LISTING_STATUS} from "../../constants/exchange";
import {listingStatusToI18nKey} from "../../utils/shakedex";

const {dialog} = require('@electron/remote');

const analytics = aClientStub(() => require('electron').ipcRenderer);

const ITEM_PER_DROPDOWN = [
  {label: '5', value: 5},
  {label: '10', value: 10},
  {label: '20', value: 20},
  {label: '50', value: 50},
  {label: '100', value: 100},
  {label: '250', value: 250},
  {label: '500', value: 500},
];

const DM_ITEMS_PER_PAGE_KEY = 'domain-manager-items-per-page';
const DM_SORT_BY_KEY = 'domain-manager-sort-by';
const AVERAGE_BLOCK_TIME = 10 * 60 * 1000;

const SORT_DROPDOWN = [
  {labelKey: 'sortName', value: 'name-asc'},
  {labelKey: 'sortNameDesc', value: 'name-desc'},
  {labelKey: 'sortExpirationSoonest', value: 'expiration-asc'},
  {labelKey: 'sortExpirationLatest', value: 'expiration-desc'},
];

class DomainManager extends Component {
  static propTypes = {
    isFetching: PropTypes.bool.isRequired,
    isLoadingShakedexListings: PropTypes.bool.isRequired,
    getExchangeListings: PropTypes.func.isRequired,
    getMyNames: PropTypes.func.isRequired,
    namesList: PropTypes.array.isRequired,
    names: PropTypes.object.isRequired,
    shakedexListings: PropTypes.array.isRequired,
  };

  static contextType = I18nContext;

  state = {
    query: '',
    isShowingNameClaimForPayment: false,
    isShowingBulkTransfer: false,
    isConfirmingBulkFinalize: false,
    currentPageIndex: 0,
    itemsPerPage: 10,
    sortBy: 'name-asc',
  };

  shouldComponentUpdate(nextProps, nextState) {
    return this.props.namesList.join('') !== nextProps.namesList.join('')
      || this.getShakedexListingsKey(this.props.shakedexListings) !== this.getShakedexListingsKey(nextProps.shakedexListings)
      || this.props.isFetching !== nextProps.isFetching
      || this.props.isLoadingShakedexListings !== nextProps.isLoadingShakedexListings
      || this.state.query !== nextState.query
      || this.state.isShowingNameClaimForPayment !== nextState.isShowingNameClaimForPayment
      || this.state.isShowingBulkTransfer !== nextState.isShowingBulkTransfer
      || this.state.isConfirmingBulkFinalize !== nextState.isConfirmingBulkFinalize
      || this.state.currentPageIndex !== nextState.currentPageIndex
      || this.state.itemsPerPage !== nextState.itemsPerPage
      || this.state.sortBy !== nextState.sortBy;
  }

  async componentDidMount() {
    this.props.getMyNames();
    this.props.getExchangeListings();
    const itemsPerPage = await dbClient.get(DM_ITEMS_PER_PAGE_KEY);
    const sortBy = await dbClient.get(DM_SORT_BY_KEY);

    this.setState({
      itemsPerPage: itemsPerPage || 10,
      sortBy: SORT_DROPDOWN.some(({ value }) => value === sortBy) ? sortBy : 'name-asc',
    });

    analytics.screenView('Domain Manager');
  }

  onChange = (name) => (e) => {
    this.setState({
      [name]: e.target.value,
    });
  };

  getNamesList() {
    let namesList = Array.from(this.props.namesList);
    let { query, sortBy } = this.state;

    if (query) {
      query = query.toLowerCase();
      namesList = namesList.filter(name => name.includes(query));
    }

    namesList.sort((a, b) => {
      const nameCompare = a.localeCompare(b);

      if (sortBy === 'name-desc') {
        return -nameCompare;
      }

      if (sortBy === 'expiration-asc' || sortBy === 'expiration-desc') {
        const aExpiration = this.getExpirationHeight(a);
        const bExpiration = this.getExpirationHeight(b);
        const expirationCompare = aExpiration - bExpiration;

        if (expirationCompare !== 0) {
          return sortBy === 'expiration-asc' ? expirationCompare : -expirationCompare;
        }
      }

      return nameCompare;
    });
    return namesList;
  }

  getExpirationHeight(name) {
    const domain = this.props.names[name];
    const network = networks[this.props.network];

    if (!domain?.renewal || !network?.names?.renewalWindow) {
      return Number.MAX_SAFE_INTEGER;
    }

    return domain.renewal + network.names.renewalWindow;
  }

  getShakedexListingsKey(listings = []) {
    return listings
      .map(listing => `${listing?.nameLock?.name || ''}:${listing?.status || ''}:${listing?.blocksUntilFinalize || ''}`)
      .sort()
      .join('|');
  }

  getShakedexListingMap() {
    const listingMap = new Map();

    for (const listing of this.props.shakedexListings || []) {
      const name = listing?.nameLock?.name;
      if (name) {
        listingMap.set(name, listing);
      }
    }

    return listingMap;
  }

  getShakedexStatusLabel(listing) {
    const {t} = this.context;

    if (!listing) {
      return t('notApplicable');
    }

    if (listing.status === LISTING_STATUS.ACTIVE) {
      return listing.marketSubmission ? t('listedOnShakedex') : t('proofReady');
    }

    const i18nKey = listingStatusToI18nKey(listing.status);
    let statusText = i18nKey ? t(i18nKey) : listing.status;

    if (listing.status === LISTING_STATUS.TRANSFER_CONFIRMED_LOCKUP && listing.blocksUntilFinalize > 0) {
      statusText = `${t('waitingForTransferShort')} ${listing.blocksUntilFinalize} ${t('blocks')}`;
    }

    return statusText;
  }

  isShakedexListed(listing) {
    return Boolean(listing && listing.status !== LISTING_STATUS.FINALIZE_CANCEL_CONFIRMED);
  }

  listOnShakedex = (event, name) => {
    event.stopPropagation();
    this.props.history.push(`/exchange?createListing=1&name=${encodeURIComponent(name)}`);
  };

  openShakedex = (event, name) => {
    event.stopPropagation();
    this.props.history.push(`/exchange?listing=${encodeURIComponent(name)}`);
  };

  getSortDropdownItems() {
    const { t } = this.context;
    return SORT_DROPDOWN.map(({ labelKey, value }) => ({
      label: t(labelKey),
      value,
    }));
  }

  handleExportClick() {
    const {
      height,
      names,
      namesList,
      network,
    } = this.props;
    const renewalWindow = networks[network].names.renewalWindow;
    const headers = [
      'name',
      'expiration_height',
      'estimated_expiration_date',
      'renewal_height',
      'hns_paid',
      'transfer_height',
      'owner_hash',
      'owner_index',
    ];
    const rows = [...namesList].sort().map((name) => {
      const domain = names[name] || {};
      const expirationHeight = domain.renewal + renewalWindow;
      const expirationDate = height && expirationHeight
        ? moment().add((expirationHeight - height) * AVERAGE_BLOCK_TIME).format('YYYY-MM-DD')
        : '';

      return [
        formatName(name),
        expirationHeight || '',
        expirationDate,
        domain.renewal || '',
        typeof domain.highest === 'number' ? domain.highest / 1e6 : '',
        domain.transfer || '',
        domain.owner?.hash || '',
        typeof domain.owner?.index === 'number' ? domain.owner.index : '',
      ];
    });
    const data = [
      headers,
      ...rows,
    ].map(row => row.map(escapeCSVValue).join(',')).join('\n');

    let savePath = dialog.showSaveDialogSync({
      filters: [{name: 'spreadsheet', extensions: ['csv']}],
    });

    if (savePath) {
      fs.writeFile(savePath, data, (err) => {
        if (err) {
          throw err;
        }
      });
    }
  }

  handleFinalizeAll = async () => {
    const {
      finalizeAll,
      showError,
      showSuccess,
    } = this.props;

    const { t } = this.context;

    if (!this.state.isConfirmingBulkFinalize) {
      return this.setState({ isConfirmingBulkFinalize: true });
    }

    try {
      const res = await finalizeAll();
      if (res !== null) {
        showSuccess(t('finalizeSuccess'));
      }
      this.setState({ isConfirmingBulkFinalize: false });
    } catch (e) {
      showError(e.message);
    }
  };

  renderGoTo(namesList) {
    const {currentPageIndex, itemsPerPage} = this.state;
    const { t } = this.context;

    const totalPages = Math.ceil(namesList.length / itemsPerPage);
    return (
      <div className="domain-manager__page-control__dropdowns">
        <div className="domain-manager__go-to">
          <div className="domain-manager__go-to__text">{`${t('itemsPerPage')}:`}</div>
          <Dropdown
            className="domain-manager__go-to__dropdown transactions__items-per__dropdown"
            items={ITEM_PER_DROPDOWN}
            onChange={async itemsPerPage => {
              await dbClient.put(DM_ITEMS_PER_PAGE_KEY, itemsPerPage);
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
            items={Array(totalPages).fill(0).map((_, i) => ({label: `${i + 1}`}))}
            onChange={currentPageIndex => this.setState({currentPageIndex})}
            currentIndex={currentPageIndex}
          />
          <div className="domain-manager__go-to__total">of {totalPages}</div>
        </div>
      </div>
    );
  }

  renderControls(namesList) {
    const {
      currentPageIndex,
      itemsPerPage,
    } = this.state;

    const totalPages = Math.ceil(namesList.length / itemsPerPage);
    const pageIndices = getPageIndices(namesList, itemsPerPage, currentPageIndex);

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
                onClick={() => this.setState({currentPageIndex: pageIndex})}
              >
                {pageIndex + 1}
              </div>
            );
          })}
          <div
            className="domain-manager__page-control__end"
            onClick={() => this.setState({
              currentPageIndex: Math.min(currentPageIndex + 1, totalPages - 1),
            })}
          />
        </div>
        {this.renderGoTo(namesList)}
      </div>
    );
  }

  renderBulkFinalize() {
    const {names, namesList} = this.props;
    const finalizables = [];

    for (const name of namesList) {
      const domain = names[name];
      const remainingBlocks = (domain.transfer + networks[this.props.network].names.transferLockup) - this.props.height;
      if (domain.transfer && remainingBlocks <= 0) {
        finalizables.push(name);
      }
    }

    return !!finalizables.length && (
      <button
        className="extension_cta_button domain-manager__export-btn"
        onClick={this.handleFinalizeAll}
      >
        {`${this.context.t('bulkFinalize')} (${finalizables.length})`}
      </button>
    )
  }

  renderList(namesList) {
    const {history} = this.props;
    const {t} = this.context;
    const {
      query,
      sortBy,
      currentPageIndex: i,
      itemsPerPage: n,
    } = this.state;

    const start = i * n;
    const end = start + n;
    const sortItems = this.getSortDropdownItems();
    const shakedexListingMap = this.getShakedexListingMap();
    const isCheckingShakedexListings = this.props.isLoadingShakedexListings && !this.props.shakedexListings.length;

    return (
      <div className="domain-manager">
        <div className="domain-manager__buttons">
          <button
            className="extension_cta_button domain-manager__export-btn"
            onClick={this.handleExportClick.bind(this)}
          >
            {t('export')}
          </button>
          <button
            className="extension_cta_button domain-manager__export-btn"
            onClick={() => this.setState({
              isShowingNameClaimForPayment: true,
            })}
          >
            {t('claimPaidTransfer')}
          </button>
          <button
            className="extension_cta_button domain-manager__export-btn"
            onClick={() => this.setState({
              isShowingBulkTransfer: true,
            })}
          >
            {t('bulkTransfer')}
          </button>
          {this.renderBulkFinalize()}
        </div>
        <div className="domain-manager__filters">
          <BidSearchInput
            className="domain-manager__search"
            placeholder={t('domainSearchPlaceholder')}
            onChange={this.onChange('query')}
            value={query}
          />
          <div className="domain-manager__sort">
            <div className="domain-manager__sort__label">{`${t('sortBy')}:`}</div>
            <Dropdown
              className="domain-manager__sort__dropdown"
              items={sortItems}
              onChange={async nextSortBy => {
                await dbClient.put(DM_SORT_BY_KEY, nextSortBy);
                this.setState({
                  sortBy: nextSortBy,
                  currentPageIndex: 0,
                });
              }}
              currentIndex={SORT_DROPDOWN.findIndex(({ value }) => value === sortBy)}
            />
          </div>
        </div>
        <Table className="domain-manager__table">
          <HeaderRow>
            <HeaderItem>{t('domain')}</HeaderItem>
            <HeaderItem>{t('expiresOn')}</HeaderItem>
            <HeaderItem>{t('shakedex')}</HeaderItem>
            <HeaderItem>{t('hnsPaid')}</HeaderItem>
            <HeaderItem />
          </HeaderRow>
          {namesList.length ? namesList.slice(start, end).map((name) => {
            const shakedexListing = shakedexListingMap.get(name);
            return (
              <DomainRow
                key={`${name}`}
                name={name}
                t={t}
                shakedexStatusLabel={this.getShakedexStatusLabel(shakedexListing)}
                isShakedexListed={this.isShakedexListed(shakedexListing)}
                isCheckingShakedexListings={isCheckingShakedexListings}
                onListOnShakedex={(event) => this.listOnShakedex(event, name)}
                onOpenShakedex={(event) => this.openShakedex(event, name)}
                onClick={() => history.push(`/domain_manager/${name}`)}
              />
            );
          }) :
          <TableRow className="table__empty-row">
            {this.context.t('domainManagerEmpty')}
          </TableRow>}
        </Table>
      </div>
    );
  }

  renderEmpty() {
    const { t } = this.context;
    return (
      <div className="domain-manager">
        <div className="domain-manager__buttons">
          <button
            className="extension_cta_button domain-manager__export-btn"
            onClick={() => this.setState({
              isShowingNameClaimForPayment: true,
            })}
          >
            {t('claimNamePaymentTitle')}
          </button>
        </div>
        <div className="domain-manager__empty-text">
          {t('domainManagerEmpty')}
        </div>
      </div>
    );
  }

  renderBody(namesList) {
    const {isFetching} = this.props;
    const { t } = this.context;

    if (isFetching) {
      return (
        <div className="domain-manager">
          <div className="domain-manager__loading">
            {t('loadingNDomains', namesList.length)}
          </div>
        </div>
      );
    }

    return this.renderList(namesList);
  }

  renderConfirmFinalizeModal() {
    if (this.state.isConfirmingBulkFinalize) {
      return (
        <BulkFinalizeWarningModal
          onClose={() => this.setState({ isConfirmingBulkFinalize: false })}
          onClick={this.handleFinalizeAll}
        />
      );
    }
  }

  render() {
    const namesList = this.getNamesList();

    return (
      <>
        {this.renderBody(namesList)}
        {this.renderControls(namesList)}
        {this.renderConfirmFinalizeModal()}
        {this.state.isShowingBulkTransfer && (
          <BulkTransfer
            onClose={() => this.setState({
              isShowingBulkTransfer: false,
            })}
          />
        )}
        {this.state.isShowingNameClaimForPayment && (
          <ClaimNameForPayment
            onClose={() => this.setState({
              isShowingNameClaimForPayment: false,
            })}
          />
        )}
      </>
    );
  }
}

function escapeCSVValue(value) {
  const stringValue = String(value ?? '');
  return `"${stringValue.replace(/"/g, '""')}"`;
}

export default withRouter(
  connect(
    state => ({
      names: state.myDomains.names,
      isFetching: state.myDomains.isFetching,
      isLoadingShakedexListings: state.exchange.isLoadingListings,
      namesList: Object.keys(state.myDomains.names),
      shakedexListings: state.exchange.listings,
      height: state.node.chain.height,
      network: state.wallet.network,
      wid: state.wallet.wid,
    }),
    dispatch => ({
      getMyNames: () => dispatch(myDomainsActions.getMyNames()),
      getExchangeListings: () => dispatch(getExchangeListings()),
      finalizeAll: () => dispatch(finalizeAll()),
      showSuccess: (message) => dispatch(showSuccess(message)),
      showError: (message) => dispatch(showError(message)),
    }),
  )(DomainManager),
);


const DomainRow = connect(
  state => ({
    names: state.myDomains.names,
    network: state.wallet.network,
  }),
)(_DomainRow);

function _DomainRow(props) {
  const {
    name,
    names,
    onClick,
    network,
    t,
    shakedexStatusLabel,
    isShakedexListed,
    isCheckingShakedexListings,
    onListOnShakedex,
    onOpenShakedex,
  } = props;
  return (
    <TableRow key={`${name}`} onClick={onClick}>
      <TableItem>{formatName(name)}</TableItem>
      <TableItem>
        {isCheckingShakedexListings ? (
          <span className="domain-manager__shakedex-loading-text">
            {t('loadingShakedexListings')}
          </span>
        ) : isShakedexListed ? (
          <div className="domain-manager__shakedex-expiry-note">
            <strong>{t('inShakedex')}</strong>
            <span>{t('shakedexExpiryManaged')}</span>
          </div>
        ) : (
          <Blocktime
            height={names[name].renewal + networks[network].names.renewalWindow}
            format="ll"
            fromNow
          />
        )}
      </TableItem>
      <TableItem>
        <span className={c('domain-manager__shakedex-badge', {
          'domain-manager__shakedex-badge--active': isShakedexListed,
          'domain-manager__shakedex-badge--loading': isCheckingShakedexListings,
        })}>
          {isCheckingShakedexListings ? t('loadingShakedex') : shakedexStatusLabel}
        </span>
      </TableItem>
      <TableItem>{displayBalance(names[name].highest, true)}</TableItem>
      <TableItem>
        {isCheckingShakedexListings ? (
          <button
            className="domain-manager__row-action"
            disabled
            title={t('loadingShakedexListings')}
          >
            {t('checking')}
          </button>
        ) : isShakedexListed ? (
          <button
            className="domain-manager__row-action"
            title={t('openShakedex')}
            onClick={onOpenShakedex}
          >
            {t('open')}
          </button>
        ) : (
          <button
            className="domain-manager__row-action"
            title={t('listOnShakedex')}
            onClick={onListOnShakedex}
          >
            {t('list')}
          </button>
        )}
      </TableItem>
    </TableRow>
  );
}

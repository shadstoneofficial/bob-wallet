import React, { Component } from 'react';
import fs from "fs";
import { connect } from 'react-redux';
import moment from 'moment';
import classNames from 'classnames';
const {dialog} = require('@electron/remote');
import { shell } from 'electron';
import { clientStub as aClientStub } from '../../background/analytics/client.js';
import { clientStub as sClientStub } from '../../background/shakedex/client.js';
import { HeaderItem, HeaderRow, Table, TableItem, TableRow } from '../../components/Table';
import {
  getExchangeAuctions,
  finalizeExchangeBid,
  finalizeExchangeLock,
  launchExchangeAuction,
} from '../../ducks/exchange.js';
import { displayBalance } from '../../utils/balances.js';
import PlaceBidModal from './PlaceBidModal.js';
import PlaceListingModal from './PlaceListingModal.js';
import * as logger from '../../utils/logClient.js';
import {
  cancelExchangeLock, finalizeCancelExchangeLock,
  FULFILLMENT_STATUS,
  getExchangeFullfillments,
  getExchangeListings,
  setAuctionPage,
  submitToShakedex,
} from "../../ducks/exchange";
import { LISTING_STATUS } from '../../constants/exchange.js';
import {formatName} from "../../utils/nameHelpers";
import {showError} from "../../ducks/notifications";
import {fromAuctionJSON, listingStatusToI18nKey, validateAuction} from "../../utils/shakedex";
import './exchange.scss';
import PropTypes from "prop-types";
import {clearDeeplinkParams} from "../../ducks/app";
import {Link} from "react-router-dom";
import GenerateListingModal from "./GenerateListingModal";
import {getPageIndices} from "../../utils/pageable";
import Dropdown from "../../components/Dropdown";
import ShakedexDeprecated from '../../components/ShakedexDeprecated/index.js';
import SpinnerSVG from '../../assets/images/brick-loader.svg';
import ConfirmFeeModal from './ConfirmFeeModal.js';
import {I18nContext} from "../../utils/i18n";
import { Auction } from 'shakedex/src/auction.js';
import {
  ACTIVE_SHAKEDEX_CHANNEL,
  getShakedexChannelBaseUrl,
} from '../../constants/shakedexChannels.js';

const analytics = aClientStub(() => require('electron').ipcRenderer);
const shakedex = sClientStub(() => require('electron').ipcRenderer);
const MARKET_STATUS_REFRESH_INTERVAL = 60000;
const MARKET_API_HOST = ACTIVE_SHAKEDEX_CHANNEL.host;
const MARKET_API_BASE_URL = getShakedexChannelBaseUrl();
const ENABLE_SPV_SELLER_BETA = process.env.BOB_SHAKEDEX_SPV_SELLER_BETA === 'true';

class Exchange extends Component {
  static propTypes = {
    spv: PropTypes.bool.isRequired,
    nodeProgress: PropTypes.number,
    walletSync: PropTypes.bool.isRequired,
    walletHeight: PropTypes.number.isRequired,
    rescanHeight: PropTypes.number,
    isCustomRPCConnected: PropTypes.bool.isRequired,
    deeplinkParams: PropTypes.object.isRequired,
    clearDeeplinkParams: PropTypes.func.isRequired,
    network: PropTypes.string.isRequired,
    height: PropTypes.number.isRequired,
    walletType: PropTypes.string.isRequired,
    walletWatchOnly: PropTypes.bool.isRequired,
  };

  static contextType = I18nContext;

  constructor(props) {
    super(props);
    this.state = {
      placingAuction: null,
      placingCurrentBid: null,
      isPlacingListing: false,
      isUploadingFile: false,
      isGeneratingListing: false,
      isShowingFeeConfirmationFor: false,
      feeInfo: null,
      generatingListing: null,
      isLoading: true,
      shakedexDeprecatedToggle: false,
      currentBidsMap: new Map(),
      marketStatus: null,
      marketStatusLoading: false,
      marketStatusCheckedAt: null,
      marketplaceQuery: '',
      marketplaceModeFilter: 'all',
      marketplaceSort: 'name',
    };

    this.marketStatusTimer = null;
  }

  componentDidMount() {
    analytics.screenView('Exchange');
    this.props.getExchangeFullfillments();
    this.props.getExchangeListings();
    if (this.isMarketplaceVisible()) {
      this.fetchShakedex();
      this.fetchMarketStatus();
      this.marketStatusTimer = setInterval(
        () => this.fetchMarketStatus({ silent: true }),
        MARKET_STATUS_REFRESH_INTERVAL,
      );
    }
  }

  componentWillUnmount() {
    if (this.marketStatusTimer) {
      clearInterval(this.marketStatusTimer);
    }
  }

  async componentDidUpdate(prevProps, prevState) {
    if (this.props.height !== prevProps.height) {
      this.props.getExchangeFullfillments();
      this.props.getExchangeListings();
    }
  }

  async fetchShakedex() {
    try {
      this.setState({ isLoading: true });
      await this.props.getExchangeAuctions();
      this.setState({ isLoading: false });
    } catch (e) {
      this.setState({ isLoading: false });
    }
  }

  async fetchMarketStatus({ silent = false } = {}) {
    try {
      if (!silent) {
        this.setState({ marketStatusLoading: true });
      }
      const marketStatus = await shakedex.getMarketHsdStatus();
      this.setState({
        marketStatus,
        marketStatusLoading: false,
        marketStatusCheckedAt: Date.now(),
      });
    } catch (e) {
      this.setState({
        marketStatus: {
          reachable: false,
          error: e.message,
        },
        marketStatusLoading: false,
        marketStatusCheckedAt: Date.now(),
      });
    }
  }

  isMarketplaceVisible() {
    return this.props.network === 'main' || Boolean(process.env.LEARNHNS_MARKET_API_HOST);
  }

  canUseMarketplaceActions() {
    return this.isBobReadyForMarketplace() && this.isMarketReadyForActions();
  }

  canStartSellerListing() {
    return this.isBobReadyForMarketplace() && (!this.props.spv || ENABLE_SPV_SELLER_BETA);
  }

  isBobReadyForMarketplace() {
    return this.props.nodeProgress >= 1 && !this.props.walletSync;
  }

  isMarketReadyForActions() {
    const { marketStatus } = this.state;

    if (!marketStatus || marketStatus.reachable === false)
      return false;

    if (typeof marketStatus.progress !== 'number')
      return true;

    return marketStatus.progress >= 0.99;
  }

  getMarketplaceNotReadyMessage() {
    if (!this.isBobReadyForMarketplace())
      return this.context.t('marketplaceWaitForSync');

    if (!this.isMarketReadyForActions())
      return this.context.t('marketplaceWaitForMarketSync');

    return '';
  }

  showMarketplaceNotReady() {
    this.props.showError(this.getMarketplaceNotReadyMessage());
  }

  showSellerNotReady() {
    this.props.showError(
      this.props.spv
        ? this.context.t('spvSellerBetaPending')
        : this.context.t('marketplaceWaitForSync'),
    );
  }

  refreshMarketplace = async () => {
    await Promise.all([
      this.fetchShakedex(),
      this.fetchMarketStatus(),
    ]);
  }

  clearMarketplaceFilters = () => this.setState({
    marketplaceQuery: '',
    marketplaceModeFilter: 'all',
    marketplaceSort: 'name',
  });

  getMarketplaceModeItems() {
    const { t } = this.context;

    return [
      { label: t('allListings'), value: 'all' },
      { label: t('buyNow'), value: 'fixed' },
      { label: t('reverseAuction'), value: 'reverse' },
    ];
  }

  getMarketplaceSortItems() {
    const { t } = this.context;

    return [
      { label: t('sortName'), value: 'name' },
      { label: t('sortLowestPrice'), value: 'price-asc' },
      { label: t('sortHighestPrice'), value: 'price-desc' },
      { label: t('sortListingMode'), value: 'mode' },
    ];
  }

  getVisibleMarketplaceAuctions() {
    const query = this.state.marketplaceQuery.trim().toLowerCase();
    const mode = this.state.marketplaceModeFilter;
    const sort = this.state.marketplaceSort;

    const filtered = this.props.auctions.filter((auction) => {
      const matchesQuery = !query || auction.name.toLowerCase().includes(query);
      const isFixed = isFixedPriceAuction(auction);
      const matchesMode = mode === 'all'
        || (mode === 'fixed' && isFixed)
        || (mode === 'reverse' && !isFixed);

      return matchesQuery && matchesMode;
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'mode') {
        const modeCompare = Number(isFixedPriceAuction(b)) - Number(isFixedPriceAuction(a));
        return modeCompare || a.name.localeCompare(b.name);
      }

      if (sort === 'price-asc' || sort === 'price-desc') {
        const aPrice = getKnownCurrentPrice(a, this.state.currentBidsMap);
        const bPrice = getKnownCurrentPrice(b, this.state.currentBidsMap);

        if (aPrice === null && bPrice === null) {
          return a.name.localeCompare(b.name);
        }

        if (aPrice === null) return 1;
        if (bPrice === null) return -1;

        return sort === 'price-asc' ? aPrice - bPrice : bPrice - aPrice;
      }

      return a.name.localeCompare(b.name);
    });
  }

  getCurrentBidForAuction = async (auction) => {
    const existing = this.state.currentBidsMap.get(auction.id);
    if (existing) {
      return existing;
    }

    const currentBid = await getCurrentBid(auction);
    const currentBidsMap = this.state.currentBidsMap;
    currentBidsMap.set(auction.id, currentBid);
    this.setState({currentBidsMap});
  }

  static async getDerivedStateFromProps(props, state) {
    try {
      const { presignJSONString } = props.deeplinkParams;
      let auction, currentBid;

      if (presignJSONString) {
        props.clearDeeplinkParams();
        auction = fromAuctionJSON(JSON.parse(presignJSONString));
        currentBid = await getCurrentBid(auction);
        return {
          ...state,
          placingAuction: auction,
          placingCurrentBid: currentBid,
          isUploadingFile: false,
        };
      }

      return state;
    } catch (e) {
      props.clearDeeplinkParams();
      return state;
    }
  }

  onUploadPresigns = async () => {
    this.setState({
      isUploadingFile: true,
    });

    try {
      const {
        filePaths: [filepath]
      } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: {
          extensions: ['json'],
        },
      });

      if (!filepath) return;

      const buf = await fs.promises.readFile(filepath);
      const content = buf.toString('utf-8');

      // Validate auction
      await Auction.fromStream(content);

      const auctionJSON = JSON.parse(content);
      const auction = fromAuctionJSON(auctionJSON);
      const currentBid = await getCurrentBid(auction);

      if (currentBid === null) {
        throw new Error('No bids available right now.');
      }

      this.setState({
        placingAuction: auction,
        placingCurrentBid: currentBid,
        isUploadingFile: false,
      });
    } catch (e) {
      console.error(e);
      this.props.showError(e.message);
      this.setState({
        placingAuction: null,
        placingCurrentBid: null,
        isUploadingFile: false,
      });
    }
  };

  onDownloadPresigns = async (listing) => {
    try {
      const submission = listing.auction;
      const content = JSON.stringify(submission);
      const data = `data:text/plain;charset=utf-8,${content}\r\n`;
      const encodedUri = encodeURI(data);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `${submission.name}-presigns.json`);
      document.body.appendChild(link); // Required for FF
      link.click();
      link.remove();
    } catch (e) {
      logger.error(e.message);
      setTimeout(() => {
        throw e;
      }, 0);
    }
  };

  onClickDownload = async (auction) => {
    try {
      const submission = {
        version: auction.version || 2,
        lockingOutputIdx: auction.lockingOutputIdx,
        lockingTxHash: auction.lockingTxHash,
        name: auction.name,
        paymentAddr: auction.paymentAddr,
        publicKey: auction.publicKey,
        feeAddr: auction.feeAddr || null,
        data: auction.bids.map(bid => ({
          price: bid.price,
          fee: bid.fee || 0,
          lockTime: bid.lockTime,
          signature: bid.signature,
        })),
      };
      const content = JSON.stringify(submission);
      const data = `data:text/plain;charset=utf-8,${content}\r\n`;
      const encodedUri = encodeURI(data);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `${submission.name}-presigns.json`);
      document.body.appendChild(link); // Required for FF
      link.click();
      link.remove();
    } catch (e) {
      logger.error(e.message);
      setTimeout(() => {
        throw e;
      }, 0);
    }
  };

  onClickSubmitShakedex = async (listing) => {
    const feeInfo = await shakedex.getFeeInfo();

    if (feeInfo.rate === 0) {
      return this.props.submitToShakedex(listing.auction);
    }

    this.setState({
      isShowingFeeConfirmationFor: listing,
      feeInfo,
    });
  };

  renderListingStatus(status, listing = {}) {
    let statusText = status;
    const {t} = this.context;

    const i18nKey = listingStatusToI18nKey(status);

    if (i18nKey)
      statusText = t(i18nKey);

    if (status === LISTING_STATUS.TRANSFER_CONFIRMED_LOCKUP && listing.blocksUntilFinalize > 0) {
      statusText = `${statusText} (${listing.blocksUntilFinalize} ${t('blocks')})`;
    }

    return (
      <div className={classNames('exchange-table__listing-status', {
        'exchange-table__listing-status--active': status === LISTING_STATUS.ACTIVE,
        'exchange-table__listing-status--transfer-confirmed': [
          LISTING_STATUS.TRANSFER_CONFIRMED,
          LISTING_STATUS.CANCEL_CONFIRMED,
        ].includes(status),
        'exchange-table__listing-status--transfer-confirming': [
          LISTING_STATUS.TRANSFER_CONFIRMING,
          LISTING_STATUS.CANCEL_CONFIRMING,
          LISTING_STATUS.FINALIZE_CANCEL_CONFIRMING,
        ].includes(status),
        'exchange-table__listing-status--sold': [
          LISTING_STATUS.SOLD,
          LISTING_STATUS.FINALIZE_CANCEL_CONFIRMED,
        ].includes(status),
        'exchange-table__listing-status--not-found': status === LISTING_STATUS.NOT_FOUND,
        'exchange-table__listing-status--finalized-confirmed': status === LISTING_STATUS.FINALIZE_CONFIRMED,
        'exchange-table__listing-status--finalized-confirming': status === LISTING_STATUS.FINALIZE_CONFIRMING,
        'exchange-table__listing-status--transfer-cofirmed-lockup': status === LISTING_STATUS.TRANSFER_CONFIRMED_LOCKUP,
      })}>
        {statusText}
      </div>
    )
  }

  renderFulfillmentStatus(status) {
    let statusText = status;
    const { t } = this.context;

    switch (status) {
      case FULFILLMENT_STATUS.NOT_FOUND:
        statusText = t('shakedexStatusNotFound');
        break;
      case FULFILLMENT_STATUS.CONFIRMING:
        statusText = t('shakedexStatusTransferringName');
        break;
      case FULFILLMENT_STATUS.CONFIRMED:
        statusText = t('shakedexStatusTransferredName');
        break;
      case FULFILLMENT_STATUS.CONFIRMED_LOCKUP:
        statusText = t('shakedexStatusConfirmedLockup');
        break;
      case FULFILLMENT_STATUS.FINALIZING:
        statusText = t('shakedexStatusFinalizingTransfer');
        break;
      case FULFILLMENT_STATUS.FINALIZED:
        statusText = t('shakedexStatusFulfilled');
        break;
    }

    return (
      <div className={classNames('exchange-table__listing-status', {
        'exchange-table__listing-status--active': status === FULFILLMENT_STATUS.FINALIZED,
        'exchange-table__listing-status--not-found': status === FULFILLMENT_STATUS.NOT_FOUND,
        'exchange-table__listing-status--transfer-confirmed': status === FULFILLMENT_STATUS.CONFIRMING,
        'exchange-table__listing-status--transfer-confirming': status === FULFILLMENT_STATUS.CONFIRMED,
        'exchange-table__listing-status--finalized-confirmed': status === FULFILLMENT_STATUS.CONFIRMED_LOCKUP,
        'exchange-table__listing-status--finalized-confirming': status === FULFILLMENT_STATUS.FINALIZING,
      })}>
        {statusText}
      </div>
    )
  }

  render() {
    const { t } = this.context;
    if (this.props.walletWatchOnly) {
      return t('notSupportWithLedger');
    }

    if (this.props.walletType === 'multisig') {
      return t('notSupportWithMultisig');
    }

    if (this.props.isLoading) {
      return t('loading');
    }

    const isSpv = this.props.spv;
    const marketplaceAuctions = this.getVisibleMarketplaceAuctions();

    return (
      <div className="exchange">
        {this.isMarketplaceVisible() && this.renderReadinessPanel()}
        {this.isMarketplaceVisible() && this.renderSellerToolsPanel()}
        {!isSpv && (
          <>
            <div className="exchange__button-header">
              <h2>{t('yourListings')}</h2>
              <button
                className="exchange__button-header-button extension_cta_button"
                disabled={!this.canStartSellerListing()}
                onClick={() => this.canStartSellerListing()
                  ? this.setState({ isPlacingListing: true })
                  : this.showSellerNotReady()}
              >
                {t('createListing')}
              </button>
            </div>
            <ShakedexDeprecated toggle={this.state.shakedexDeprecatedToggle} />
            <div className="exchange__button-header__sub">
              {t('sdBackupReminder', '')}
              <Link to="/settings/exchange/backup">Settings/Exchange</Link>
            </div>
            <Table className="exchange-table">
              <HeaderRow>
                <HeaderItem>{t('domain')}</HeaderItem>
                <HeaderItem>{t('status')}</HeaderItem>
                <HeaderItem>{t('listingType')}</HeaderItem>
                <HeaderItem>{t('price')}</HeaderItem>
                <HeaderItem />
              </HeaderRow>
              {!this.props.listings.length && (
                <TableRow>
                  <TableItem>
                    {t('noListingFound')}
                  </TableItem>
                </TableRow>
              )}
              {!!this.props.listings.length && this.props.listings.map((l, i) => this.renderListingRow(l, i))}
            </Table>

            <div className="exchange__button-header">
              <h2>{t('yourFills')}</h2>
              <button
                className="exchange__button-header-button extension_cta_button"
                onClick={this.onUploadPresigns}
              >
                {t('loadAuctionFile')}
              </button>
            </div>
            <Table className="exchange-table">
              <HeaderRow>
                <HeaderItem>{t('domain')}</HeaderItem>
                <HeaderItem>{t('status')}</HeaderItem>
                <HeaderItem>{t('amount')}</HeaderItem>
                <HeaderItem>{t('fillPlacedAt')}</HeaderItem>
                <HeaderItem />
              </HeaderRow>

              {!!this.props.fulfillments.length && this.props.fulfillments.map((f, idx) => (
                <TableRow key={idx}>
                  <TableItem>{formatName(f.fulfillment.name)}</TableItem>
                  <TableItem>{this.renderFulfillmentStatus(f.status)}</TableItem>
                  <TableItem>{displayBalance(f.fulfillment.price, true)}</TableItem>
                  <TableItem>{moment(f.fulfillment.broadcastAt).format('MM/DD/YYYY HH:MM:SS')}</TableItem>
                  <TableItem>
                    {[FULFILLMENT_STATUS.CONFIRMED].includes(f.status)  && (
                      <div className="bid-action">
                        <div
                          className="bid-action__link"
                          onClick={() => this.props.finalizeExchangeBid(f.fulfillment)}
                        >
                          {this.props.finalizingName === f.name ? 'Finalizing...' : 'Finalize'}
                        </div>
                      </div>
                    )}
                  </TableItem>
                </TableRow>
              ))}
              {!this.props.fulfillments.length && (
                <TableRow>
                  <TableItem>{t('noFillsFound')}</TableItem>
                </TableRow>
              )}
            </Table>
          </>
        )}

        {this.isMarketplaceVisible() ? <>
        <div className="exchange-marketplace-header">
          <div>
            <h2>{t('learnHnsMarketplace')}</h2>
            <div className="exchange-marketplace-header__channel">
              {`${t('activeChannel')}: ${ACTIVE_SHAKEDEX_CHANNEL.label} (${MARKET_API_HOST})`}
            </div>
          </div>
          <div className="exchange-marketplace-header__actions">
            <button
              className="exchange-marketplace-header__button"
              disabled={this.state.isLoading || this.state.marketStatusLoading}
              onClick={this.refreshMarketplace}
            >
              {t('refresh')}
            </button>
            <button
              className="exchange-marketplace-header__button"
              onClick={() => shell.openExternal(MARKET_API_BASE_URL)}
            >
              {t('openLearnHnsMarket')}
            </button>
            <button
              className="exchange-marketplace-header__button"
              onClick={() => shell.openExternal(`${MARKET_API_BASE_URL}/status`)}
            >
              {t('openChannelStatus')}
            </button>
          </div>
        </div>
        {this.renderMarketplaceFilters(marketplaceAuctions.length)}
        {isSpv && (
          <div className="exchange__button-header__sub">
            {t('spvMarketplaceEnabled')}
          </div>
        )}
        <Table className="exchange-table">
          <Header />
          {this.state.isLoading && (
            <TableRow>
              <div className="loader" style={{ backgroundImage: `url(${SpinnerSVG})`}} />
            </TableRow>
          )}
          {!this.state.isLoading && !!marketplaceAuctions.length && marketplaceAuctions.map(this.renderAuctionRow)}
          {this.renderListingControls()}
          {!this.state.isLoading && !marketplaceAuctions.length && (
            <TableRow>
              <TableItem>
                {t('noMarketplaceListingsFound')}
              </TableItem>
            </TableRow>
          )}
          {this.props.isError && (
            <div>
              {t('genericError')}
            </div>
          )}
        </Table></> : null}
        {this.state.placingAuction && this.state.placingCurrentBid && (
          <PlaceBidModal
            auction={this.state.placingAuction}
            bid={this.state.placingCurrentBid}
            onClose={() => this.setState({
              placingAuction: null,
              placingCurrentBid: null,
            })}
          />
        )}
        {this.state.isPlacingListing && (
          <PlaceListingModal
            onClose={() => this.setState({
              isPlacingListing: false,
            })}
          />
        )}
        {this.state.isGeneratingListing && (
          <GenerateListingModal
            listing={this.state.generatingListing}
            onClose={() => this.setState({
              isGeneratingListing: false,
              generatingListing: null,
            })}
          />
        )}
        {this.state.isShowingFeeConfirmationFor && (
          <ConfirmFeeModal
            listing={this.state.isShowingFeeConfirmationFor}
            feeInfo={this.state.feeInfo}
            onClose={() => this.setState({
              isShowingFeeConfirmationFor: null,
              feeInfo: null,
            })}
          />
        )}
      </div>
    );
  }

  renderListingControls = () => {
    const {
      auctions,
      total,
      currentPage: currentPageIndex,
    } = this.props;

    const {t} = this.context;

    if (!auctions.length) {
      return null;
    }

    const totalPages = Math.ceil(total / 20);
    const pageIndices = getPageIndices(Array(total).fill(0), 20, currentPageIndex - 1);

    return (
      <div className="domain-manager__page-control">
        <div className="domain-manager__page-control__numbers">
          <div
            className="domain-manager__page-control__start"
            onClick={async () => {
              this.props.setAuctionPage(Math.max(currentPageIndex - 1, 1));
              this.fetchShakedex();
            }}
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
                className={classNames('domain-manager__page-control__page', {
                  'domain-manager__page-control__page--active': currentPageIndex === pageIndex + 1,
                })}
                onClick={async () => {
                  this.props.setAuctionPage(pageIndex + 1);
                  this.fetchShakedex();
                }}
              >
                {pageIndex + 1}
              </div>
            )
          })}
          <div
            className="domain-manager__page-control__end"
            onClick={async () => {
              this.props.setAuctionPage(Math.min(currentPageIndex + 1, totalPages));
              this.fetchShakedex();
            }}
          />
        </div>
        <div className="domain-manager__go-to">
          <div className="domain-manager__go-to__text">{t('page')}</div>
          <Dropdown
            className="domain-manager__go-to__dropdown"
            items={Array(totalPages).fill(0).map((_, i) => ({ label: `${i + 1}` }))}
            onChange={async currentPageIndex => {
              this.props.setAuctionPage(currentPageIndex + 1);
              this.fetchShakedex();
            }}
            currentIndex={currentPageIndex - 1}
          />
          <div className="domain-manager__go-to__total">of {totalPages}</div>
        </div>
      </div>
    )
  }

  renderMarketplaceFilters(visibleCount) {
    const { t } = this.context;
    const modeItems = this.getMarketplaceModeItems();
    const sortItems = this.getMarketplaceSortItems();
    const currentModeIndex = modeItems.findIndex(item => item.value === this.state.marketplaceModeFilter);
    const currentSortIndex = sortItems.findIndex(item => item.value === this.state.marketplaceSort);
    const isFiltered = Boolean(this.state.marketplaceQuery.trim())
      || this.state.marketplaceModeFilter !== 'all'
      || this.state.marketplaceSort !== 'name';

    return (
      <div className="exchange-marketplace-filters">
        <div className="exchange-marketplace-filters__search">
          <input
            value={this.state.marketplaceQuery}
            onChange={(e) => this.setState({ marketplaceQuery: e.target.value })}
            placeholder={t('searchMarketplaceListings')}
          />
        </div>
        <Dropdown
          className="exchange-marketplace-filters__mode"
          items={modeItems}
          currentIndex={Math.max(currentModeIndex, 0)}
          onChange={(marketplaceModeFilter) => this.setState({ marketplaceModeFilter })}
        />
        <Dropdown
          className="exchange-marketplace-filters__sort"
          items={sortItems}
          currentIndex={Math.max(currentSortIndex, 0)}
          onChange={(marketplaceSort) => this.setState({ marketplaceSort })}
        />
        <div className="exchange-marketplace-filters__count">
          {`${visibleCount} ${visibleCount === 1 ? t('listing') : t('listings')}`}
        </div>
        {isFiltered && (
          <button
            className="exchange-marketplace-filters__clear"
            onClick={this.clearMarketplaceFilters}
          >
            {t('clearFilters')}
          </button>
        )}
      </div>
    );
  }

  renderSellerToolsPanel() {
    const { t } = this.context;
    const canStartSellerListing = this.canStartSellerListing();

    return (
      <div className="exchange-seller-tools">
        <div className="exchange-seller-tools__copy">
          <div className="exchange-seller-tools__eyebrow">{t('sellerTools')}</div>
          <h2>{t('sellOnLearnHns')}</h2>
          <p>{t('learnHnsSellerToolsIntro')}</p>
          <div className="exchange-seller-tools__modes">
            <span>{t('buyNow')}</span>
            <span>{t('reverseAuction')}</span>
          </div>
          <div className="exchange-seller-tools__steps">
            <div>{t('sellerStepLock')}</div>
            <div>{t('sellerStepWait')}</div>
            <div>{t('sellerStepFinalize')}</div>
            <div>{t('sellerStepBackup')}</div>
          </div>
          <div className="exchange-seller-tools__note">
            {this.props.spv
              ? ENABLE_SPV_SELLER_BETA
                ? t('spvSellerBetaEnabled')
                : t('spvSellerBetaPending')
              : t('learnHnsSellerFlowNote')}
          </div>
        </div>
        <button
          className="exchange-seller-tools__button"
          disabled={!canStartSellerListing}
          onClick={() => canStartSellerListing
            ? this.setState({ isPlacingListing: true })
            : this.showSellerNotReady()}
        >
          {t('createListing')}
        </button>
      </div>
    );
  }

  renderReadinessPanel() {
    const { t } = this.context;
    const {
      spv,
      nodeProgress,
      walletSync,
      walletHeight,
      rescanHeight,
      height,
      isCustomRPCConnected,
    } = this.props;
    const {
      marketStatus,
      marketStatusLoading,
      marketStatusCheckedAt,
    } = this.state;

    const nodePercent = nodeProgress ? Math.min(100, nodeProgress * 100).toFixed(2) : '0.00';
    const walletPercent = walletSync && rescanHeight
      ? Math.min(100, (walletHeight * 100) / rescanHeight).toFixed(0)
      : null;
    const marketReachable = marketStatus && marketStatus.reachable !== false;
    const marketProgress = marketStatus && typeof marketStatus.progress === 'number'
      ? Math.min(100, marketStatus.progress * 100).toFixed(2)
      : null;
    const marketIsSyncing = marketReachable
      && typeof marketStatus.progress === 'number'
      && marketStatus.progress < 0.99;
    const marketplaceNotReadyMessage = this.getMarketplaceNotReadyMessage();

    return (
      <div className="exchange-readiness">
        <div className="exchange-readiness__item">
          <div className="exchange-readiness__label">{t('bobMode')}</div>
          <div className="exchange-readiness__value">
            {isCustomRPCConnected ? t('customRpcMode') : spv ? t('spvMode') : t('fullNodeMode')}
          </div>
        </div>
        <div className="exchange-readiness__item">
          <div className="exchange-readiness__label">{t('bobSync')}</div>
          <div className={classNames('exchange-readiness__value', {
            'exchange-readiness__value--ready': this.isBobReadyForMarketplace(),
            'exchange-readiness__value--waiting': !this.isBobReadyForMarketplace(),
          })}>
            {this.isBobReadyForMarketplace()
              ? height
                ? `${t('ready')} (${height})`
                : t('ready')
              : walletSync && walletPercent
                ? `${t('rescanning')} ${walletPercent}%`
                : `${t('synchronizing')} ${nodePercent}%`}
          </div>
        </div>
        <div className="exchange-readiness__item">
          <div className="exchange-readiness__label">{t('learnHnsMarket')}</div>
          <div className={classNames('exchange-readiness__value', {
            'exchange-readiness__value--ready': marketReachable,
            'exchange-readiness__value--waiting': !marketReachable,
          })}>
            {marketStatusLoading || !marketStatus
              ? t('checking')
              : marketReachable
                ? marketProgress
                  ? `${marketIsSyncing ? t('synchronizing') : t('online')} (${marketProgress}%)`
                  : t('online')
                : t('unreachable')}
          </div>
        </div>
        {marketplaceNotReadyMessage && (
          <div className="exchange-readiness__note">
            {marketplaceNotReadyMessage}
          </div>
        )}
        {marketStatusCheckedAt && (
          <div className="exchange-readiness__note">
            {`${t('marketStatusChecked')} ${moment(marketStatusCheckedAt).format('HH:mm:ss')}`}
          </div>
        )}
      </div>
    );
  }

  renderListingRow = (l, idx) => {
    const { auction, deprecated, lowestDeprecatedPrice } = l;
    const listingMode = l.params.mode || 'reverse';
    const { data = [] } = auction || {};
    const lastBid = data[data.length - 1];
    const { lockTime = 0 } = lastBid || {}
    const now = Date.now();
    const hasLastBidReleased = now > lockTime * 1000;
    const {t} = this.context;

    return (
      <TableRow key={idx}>
        <TableItem>
          {formatName(l.nameLock.name)}{' '}
          {deprecated ?
            <span
              className="pointer"
              onClick={() => this.setState({shakedexDeprecatedToggle: !this.state.shakedexDeprecatedToggle})}
            >⚠️</span>
            : null
          }
          {(!deprecated && lowestDeprecatedPrice && lowestDeprecatedPrice < l.params.startPrice) ?
            <span
              title={`Can be sold for ${(lowestDeprecatedPrice/1e6)>>>0} HNS, cancel listing to prevent this.`}
            >
              <div className="domains__bid-now__info__icon info" />
            </span>
            : null
          }
        </TableItem>
        <TableItem>{this.renderListingStatus(l.status, l)}</TableItem>
        <TableItem>{listingMode === 'fixed' ? t('buyNow') : t('reverseAuction')}</TableItem>
        <TableItem>
          {listingMode === 'fixed'
            ? displayBalance(l.params.price)
            : `${displayBalance(l.params.startPrice)} -> ${displayBalance(l.params.endPrice)}`}
        </TableItem>
        <TableItem>
          {l.status === LISTING_STATUS.TRANSFER_CONFIRMED && (
            <div className="bid-action">
              <div
                className="bid-action__link"
                onClick={() => this.canUseMarketplaceActions()
                  ? this.props.finalizeExchangeLock(l.nameLock)
                  : this.showMarketplaceNotReady()}
              >
                {this.props.finalizingName === l.nameLock.name ? `${t('finalizing')}...` : t('finalize')}
              </div>
            </div>
          )}
          {l.status === LISTING_STATUS.FINALIZE_CONFIRMED && (
            <div className="bid-action">
              <div
                className="bid-action__link"
                onClick={() => this.setState({
                  isGeneratingListing: true,
                  generatingListing: l,
                })}
              >
                {t('generate')}
              </div>
            </div>
          )}
          {l.status === LISTING_STATUS.CANCEL_CONFIRMED && (
            <div className="bid-action">
              <div
                className="bid-action__link"
                onClick={() => this.canUseMarketplaceActions()
                  ? this.props.finalizeCancelExchangeLock(l.nameLock)
                  : this.showMarketplaceNotReady()}
              >
                {t('finalizeCancel')}
              </div>
            </div>
          )}
          {l.status === LISTING_STATUS.ACTIVE && (
            <div className="bid-action">
              {
                (!auction && hasLastBidReleased) && (
                  <div
                    className="bid-action__link"
                    onClick={() => this.setState({
                      isGeneratingListing: true,
                      generatingListing: l,
                    })}
                  >
                    {t('regenerate')}
                  </div>
                )
              }
              <div
                className="bid-action__link"
                onClick={() => this.onDownloadPresigns(l)}
              >
                {t('download')}
              </div>
              {this.props.network === 'main' && (
                l.deprecated ?
                  <div
                    className="bid-action__link"
                    onClick={() => this.setState({
                      isGeneratingListing: true,
                      generatingListing: l,
                    })}
                  >
                    {t('regenerate')}
                  </div>
                  : <div
                    className="bid-action__link"
                    onClick={() => this.canUseMarketplaceActions()
                      ? this.onClickSubmitShakedex(l)
                      : this.showMarketplaceNotReady()}
                  >
                    {t('submit')}
                  </div>
              )}

              <div
                className="bid-action__link"
                onClick={() => this.canUseMarketplaceActions()
                  ? this.props.cancelExchangeLock(l.nameLock)
                  : this.showMarketplaceNotReady()}
              >
                {t('cancel')}
              </div>
            </div>
          )}
        </TableItem>
      </TableRow>
    );
  };

  renderAuctionRow = (auction) => {
    const {t} = this.context;
    const currentBid = this.state.currentBidsMap.get(auction.id);
    if (currentBid === undefined) {
      this.getCurrentBidForAuction(auction);
    }

    const currentPriceText = currentBid === null ? t('sold') : displayBalance(currentBid?.price, true);

    return (
      <TableRow
        key={auction.id}
        className="exchange__auction-listing__row"
        onClick={() => shell.openExternal(`${MARKET_API_BASE_URL}/listing/${auction.name}`)}
      >
        <TableItem>{formatName(auction.name)}</TableItem>
        <TableItem>{currentPriceText}</TableItem>
        <TableItem>{this.renderMarketplaceMode(auction)}</TableItem>
        <TableItem>
          {
            !auction.spendingStatus && (
              <div className="exchange__auction-row-buttons">
                <div
                  className={classNames('bid-action__link', {
                    'bid-action__link--disabled': !this.canUseMarketplaceActions(),
                  })}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!this.canUseMarketplaceActions()) {
                      this.showMarketplaceNotReady();
                      return;
                    }
                    if (!currentBid) return;
                    this.setState({
                      placingAuction: auction,
                      placingCurrentBid: currentBid,
                    });
                  }}
                >
                  {t('buyNow')}
                </div>
                <div
                  className="bid-action__link"
                  onClick={(e) => {
                    e.stopPropagation();
                    this.onClickDownload(auction);
                  }}
                >
                  {t('downloadProofs')}
                </div>
                <div
                  className="bid-action__link"
                  onClick={(e) => {
                    e.stopPropagation();
                    shell.openExternal(`${MARKET_API_BASE_URL}/listing/${auction.name}`);
                  }}
                >
                  {t('viewListing')}
                </div>
              </div>
            )
          }
        </TableItem>
      </TableRow>
    );
  };

  renderNextBid(auction) {
    const {t} = this.context;

    if (auction.spendingStatus) {
      switch (auction.spendingStatus) {
        case "COMPLETED":
          return t('sold');
        case "CANCELLED":
          return t('cancelled');
      }
    }

    const currentBid = this.state.currentBidsMap.get(auction.id);
    if (currentBid === undefined) {
      this.getCurrentBidForAuction(auction);
      return 'Loading...'
    }

    if (!currentBid) {
      return t('sold');
    }

    const currentBidIdx = auction.bids.findIndex((bid) => bid.price === currentBid.price);

    if (currentBidIdx === -1) {
      return 'Not found';
    }

    const nextBid = auction.bids[currentBidIdx+1]

    if (!nextBid) {
      return t('allBidsReleased');
    }

    return moment(nextBid.lockTime*1000).fromNow();
  }

  renderMarketplaceMode(auction) {
    if (isFixedPriceAuction(auction)) {
      return this.context.t('buyNow');
    }

    return this.renderNextBid(auction);
  }
}

class Header extends Component {
  static contextType = I18nContext;

  render() {
    const {t} = this.context;
    return (
      <HeaderRow>
        <HeaderItem>{t('domain')}</HeaderItem>
        <HeaderItem>{t('marketplacePrice')}</HeaderItem>
        <HeaderItem>{t('listingMode')}</HeaderItem>
        <HeaderItem />
      </HeaderRow>
    );
  }
}

function isFixedPriceAuction(auction) {
  return Array.isArray(auction?.bids) && auction.bids.length === 1;
}

function getKnownCurrentPrice(auction, currentBidsMap) {
  const currentBid = currentBidsMap.get(auction.id);

  if (currentBid === undefined || currentBid === null) {
    return null;
  }

  return currentBid.price;
}

export default connect(
  (state) => ({
    auctions: state.exchange.auctionIds.map(id => state.exchange.auctions[id]),
    total: state.exchange.total,
    currentPage: state.exchange.currentPage,
    fulfillments: state.exchange.fulfillments,
    listings: state.exchange.listings,
    finalizingName: state.exchange.finalizingName,
    deeplinkParams: state.app.deeplinkParams,
    walletType: state.wallet.type,
    walletWatchOnly: state.wallet.watchOnly,
    spv: state.node.spv,
    nodeProgress: state.node.chain.progress || 0,
    walletSync: state.wallet.walletSync,
    walletHeight: state.wallet.walletHeight,
    rescanHeight: state.wallet.rescanHeight,
    isCustomRPCConnected: state.node.isCustomRPCConnected,
    network: state.wallet.network,
    height: state.node.chain.height,
  }),
  (dispatch) => ({
    setAuctionPage: (page) => dispatch(setAuctionPage(page)),
    getExchangeAuctions: () => dispatch(getExchangeAuctions()),
    getExchangeFullfillments: (page) => dispatch(getExchangeFullfillments(page)),
    getExchangeListings: (page) => dispatch(getExchangeListings(page)),
    finalizeExchangeBid: (fulfillment) => dispatch(finalizeExchangeBid(fulfillment)),
    finalizeExchangeLock: (nameLock) => dispatch(finalizeExchangeLock(nameLock)),
    cancelExchangeLock: (nameLock) => dispatch(cancelExchangeLock(nameLock)),
    finalizeCancelExchangeLock: (nameLock) => dispatch(finalizeCancelExchangeLock(nameLock)),
    launchExchangeAuction: (nameLock) => dispatch(launchExchangeAuction(nameLock)),
    submitToShakedex: (auction) => dispatch(submitToShakedex(auction)),
    showError: (errorMessage) => dispatch(showError(errorMessage)),
    clearDeeplinkParams: () => dispatch(clearDeeplinkParams()),
  }),
)(Exchange);


async function getCurrentBid(auction) {
  try {
    const [bestBid, bestBidIdx] = await shakedex.getBestBid(auction);
    if (!bestBid)
      return null;

    return auction.bids[bestBidIdx];
  } catch (error) {
    return null;
  }
}

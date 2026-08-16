import React, { Component } from 'react';
import fs from "fs";
import { connect } from 'react-redux';
import moment from 'moment';
import classNames from 'classnames';
const {dialog} = require('electron');
import { shell } from 'electron';
import { clientStub as aClientStub } from '../../background/analytics/client.js';
import { clientStub as sClientStub } from '../../background/shakedex/client.js';
import { HeaderItem, HeaderRow, Table, TableItem, TableRow } from '../../components/Table';
import {
  getExchangeAuctions,
  finalizeExchangeBid,
  finalizeExchangeLock,
  launchExchangeAuctionsBulk,
  launchExchangeAuction,
} from '../../ducks/exchange.js';
import { displayBalance } from '../../utils/balances.js';
import PlaceBidModal from './PlaceBidModal.js';
import PlaceListingModal from './PlaceListingModal.js';
import * as logger from '../../utils/logClient.js';
import {
  cancelExchangeLock, finalizeCancelExchangeLock,
  createPrivateSaleProof,
  FULFILLMENT_STATUS,
  getExchangeFullfillments,
  getExchangeListings,
  setAuctionPage,
  submitToShakedex,
} from "../../ducks/exchange";
import { LISTING_STATUS } from '../../constants/exchange.js';
import {formatName} from "../../utils/nameHelpers";
import {showError, showSuccess} from "../../ducks/notifications";
import {
  fromAuctionJSON,
  isSellerListingNeedsAction,
  listingStatusToI18nKey,
  validateAuction,
} from "../../utils/shakedex";
import './exchange.scss';
import PropTypes from "prop-types";
import {clearDeeplinkParams} from "../../ducks/app";
import traceDeeplink from '../../utils/deeplinkTrace';
import {Link} from "react-router-dom";
import GenerateListingModal from "./GenerateListingModal";
import {getPageIndices} from "../../utils/pageable";
import {toSafeFilenamePart, walletFileLabel} from "../../utils/filenames";
import Dropdown from "../../components/Dropdown";
import ShakedexDeprecated from '../../components/ShakedexDeprecated/index.js';
import SpinnerSVG from '../../assets/images/brick-loader.svg';
import ConfirmFeeModal from './ConfirmFeeModal.js';
import MiniModal from '../../components/Modal/MiniModal.js';
import {I18nContext} from "../../utils/i18n";
import { Auction } from 'shakedex/src/auction.js';
import {
  DEFAULT_SHAKEDEX_CHANNEL_HOST,
  getShakedexChannelBaseUrl,
} from '../../constants/shakedexChannels.js';
import { isPendingMarketplaceAuction } from '../../utils/marketplaceAuctions';
import {
  getMarketplaceViewState,
  MARKETPLACE_STATUS,
} from '../../utils/marketplaceRequest';

const analytics = aClientStub(() => require('electron').ipcRenderer);
const shakedex = sClientStub(() => require('electron').ipcRenderer);
const MARKET_STATUS_REFRESH_INTERVAL = 60000;
const ENABLE_SPV_SELLER_BETA = process.env.BOB_SHAKEDEX_SPV_SELLER_BETA !== 'false';
const PRIVATE_SALE_DURATION_OPTS = [7, 14, 30, 90, 180, 365];
const DEFAULT_PRIVATE_SALE_DURATION_DAYS = 30;

function getAuctionExpiryTime(auction) {
  if (!auction) {
    return null;
  }

  if (auction.expiresAt) {
    const expiresAt = Number(auction.expiresAt);
    if (Number.isFinite(expiresAt)) {
      return expiresAt * 1000;
    }

    const parsedExpiresAt = Date.parse(auction.expiresAt);
    if (!Number.isNaN(parsedExpiresAt)) {
      return parsedExpiresAt;
    }
  }

  const lockTimes = (auction.bids || [])
    .map((bid) => Number(bid.lockTime))
    .filter((lockTime) => Number.isFinite(lockTime) && lockTime > 0);

  if (!lockTimes.length) {
    return null;
  }

  return Math.max(...lockTimes) * 1000;
}

function isAuctionExpired(auction) {
  const expiryTime = getAuctionExpiryTime(auction);
  return Boolean(expiryTime && expiryTime <= Date.now());
}

function getAuctionExpiryLabel(auction) {
  const expiryTime = getAuctionExpiryTime(auction);
  if (!expiryTime) {
    return 'Not generated';
  }

  const daysLeft = Math.max(0, Math.ceil((expiryTime - Date.now()) / (24 * 60 * 60 * 1000)));
  return `${moment(expiryTime).utc().format('YYYY-MM-DD')} (${daysLeft}d)`;
}

function isShortFixedListingProof(listing) {
  const expiryTime = getAuctionExpiryTime(listing?.auction);
  if (!expiryTime || (listing?.params?.mode || 'reverse') !== 'fixed') {
    return false;
  }

  return expiryTime - Date.now() < 30 * 24 * 60 * 60 * 1000;
}

export class Exchange extends Component {
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
    walletId: PropTypes.string.isRequired,
    walletsDetails: PropTypes.object.isRequired,
  };

  static contextType = I18nContext;

  constructor(props) {
    super(props);
    this.state = {
      placingAuction: null,
      placingCurrentBid: null,
      placingAuctionSource: null,
      isPlacingListing: false,
      isUploadingFile: false,
      isGeneratingListing: false,
      isGeneratingReadyListings: false,
      isBackingUpMarketplaceData: false,
      isShowingFeeConfirmationFor: false,
      submitConfirmationListing: null,
      isSubmittingListingProof: false,
      submitListingError: '',
      feeInfo: null,
      generatingListing: null,
      isLoadingLocalListings: true,
      shakedexDeprecatedToggle: false,
      currentBidsMap: new Map(),
      marketStatus: null,
      marketStatusLoading: false,
      marketStatusCheckedAt: null,
      marketChannelHost: DEFAULT_SHAKEDEX_CHANNEL_HOST,
      marketplaceQuery: '',
      marketplaceAvailabilityFilter: 'available',
      marketplaceModeFilter: 'all',
      marketplaceSort: 'name',
      listingsQuery: '',
      listingsStatusFilter: 'all',
      listingsSort: 'name-asc',
      isHandlingFulfillAuctionDeeplink: false,
      deeplinkAuctionName: '',
      bulkGeneratingNames: [],
      bulkSubmittingNames: [],
      preparingSubmitNames: [],
      bulkGenerateNotice: null,
      privateSaleListing: null,
      privateSalePrice: '',
      privateSaleDurationIdx: PRIVATE_SALE_DURATION_OPTS.indexOf(DEFAULT_PRIVATE_SALE_DURATION_DAYS),
      privateSaleError: '',
      isCreatingPrivateProof: false,
      initialListingName: '',
      shouldScrollToSellerListings: false,
    };

    this.marketStatusTimer = null;
    this.sellerListingsRef = React.createRef();
  }

  componentDidMount() {
    analytics.screenView('Exchange');
    this.refreshLocalListings();
    this.handleExchangeUrlParams();
    if (this.isMarketplaceVisible()) {
      this.fetchChannelSettings();
      this.fetchShakedex();
      this.fetchMarketStatus();
      this.handleFulfillAuctionDeeplink();
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

  getExchangeUrlParams() {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';

    return new URLSearchParams(search || hashQuery);
  }

  handleExchangeUrlParams() {
    const params = this.getExchangeUrlParams();
    const name = params.get('name') || params.get('listing') || '';

    if (!name) {
      return;
    }

    if (params.get('createListing') === '1') {
      this.setState({
        isPlacingListing: true,
        initialListingName: name,
      });
      return;
    }

    if (params.get('listing')) {
      this.setState({
        listingsQuery: name,
        listingsStatusFilter: 'all',
        listingsSort: 'name-asc',
        shouldScrollToSellerListings: true,
      });
    }
  }

  async componentDidUpdate(prevProps, prevState) {
    if (this.props.height !== prevProps.height) {
      this.refreshLocalListings();
    }

    if (this.props.walletId !== prevProps.walletId) {
      this.refreshLocalListings();
      setTimeout(this.refreshLocalListings, 750);
    }

    if (this.props.deeplinkParams !== prevProps.deeplinkParams) {
      this.handleFulfillAuctionDeeplink();
    }

    if (
      this.state.shouldScrollToSellerListings
      && !this.state.isLoadingLocalListings
      && this.sellerListingsRef.current
    ) {
      this.sellerListingsRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      this.setState({ shouldScrollToSellerListings: false });
    }

    if (
      this.state.preparingSubmitNames.length
      && this.props.listings !== prevProps.listings
    ) {
      const activeNames = new Set(
        this.props.listings
          .filter(listing => listing.status === LISTING_STATUS.ACTIVE)
          .map(listing => listing.nameLock && listing.nameLock.name)
          .filter(Boolean),
      );
      const preparingSubmitNames = this.state.preparingSubmitNames
        .filter(name => !activeNames.has(name));

      if (preparingSubmitNames.length !== this.state.preparingSubmitNames.length) {
        this.setState({ preparingSubmitNames });
      }
    }
  }

  async fetchShakedex(availability = this.state.marketplaceAvailabilityFilter) {
    return this.props.getExchangeAuctions(availability);
  }

  async fetchChannelSettings() {
    try {
      const settings = await shakedex.getShakedexChannelSettings();
      this.setState({marketChannelHost: settings.host});
    } catch (e) {
      this.setState({marketChannelHost: DEFAULT_SHAKEDEX_CHANNEL_HOST});
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
      this.fetchChannelSettings(),
      this.fetchShakedex(),
      this.fetchMarketStatus(),
    ]);
  }

  refreshLocalListings = async () => {
    this.setState({ isLoadingLocalListings: true });

    const results = await Promise.all([
      this.props.getExchangeFullfillments(),
      this.props.getExchangeListings(),
    ]);

    this.setState({
      isLoadingLocalListings: false,
    });

    return results[1] || [];
  }

  getReadyToGenerateListings() {
    return this.props.listings.filter(l => l.status === LISTING_STATUS.FINALIZE_CONFIRMED);
  }

  getListingName(listing) {
    return String(listing && listing.nameLock && listing.nameLock.name || '');
  }

  getListingSortPrice(listing) {
    const mode = listing && listing.params && listing.params.mode || 'reverse';
    if (mode === 'fixed') {
      return Number(listing.params.price);
    }

    return Number(listing.params.startPrice);
  }

  getListingExpiryTime(listing) {
    return getAuctionExpiryTime(listing && listing.auction) || Number.MAX_SAFE_INTEGER;
  }

  getListingsStatusItems() {
    const { t } = this.context;

    return [
      { label: t('allSellerListings'), value: 'all' },
      { label: t('sellerListingsNeedsAction'), value: 'needs-action' },
      { label: t('sellerListingsListed'), value: LISTING_STATUS.ACTIVE },
      { label: t('sellerListingsSalePending'), value: LISTING_STATUS.SALE_PENDING },
      { label: t('sellerListingsSold'), value: LISTING_STATUS.SOLD },
      { label: t('sellerListingsPreparing'), value: 'preparing' },
      { label: t('sellerListingsCancelled'), value: 'cancelled' },
    ];
  }

  getListingsSortItems() {
    const { t } = this.context;

    return [
      { label: t('sortName'), value: 'name-asc' },
      { label: t('sortNameDesc'), value: 'name-desc' },
      { label: t('sellerListingsSortStatus'), value: 'status' },
      { label: t('sellerListingsSortPriceLow'), value: 'price-asc' },
      { label: t('sellerListingsSortPriceHigh'), value: 'price-desc' },
      { label: t('sellerListingsSortExpiresSoon'), value: 'expires-asc' },
      { label: t('sellerListingsSortExpiresLatest'), value: 'expires-desc' },
    ];
  }

  getVisibleListings() {
    const query = this.state.listingsQuery.trim().toLowerCase();
    const statusFilter = this.state.listingsStatusFilter;
    const sort = this.state.listingsSort;
    const preparing = new Set([
      LISTING_STATUS.TRANSFER_CONFIRMING,
      LISTING_STATUS.TRANSFER_CONFIRMED_LOCKUP,
      LISTING_STATUS.FINALIZE_CONFIRMING,
    ]);
    const cancelled = new Set([
      LISTING_STATUS.CANCEL_CONFIRMING,
      LISTING_STATUS.FINALIZE_CANCEL_CONFIRMING,
      LISTING_STATUS.FINALIZE_CANCEL_CONFIRMED,
    ]);

    const filtered = this.props.listings.filter((listing) => {
      const name = this.getListingName(listing).toLowerCase();
      const matchesQuery = !query || name.includes(query);
      let matchesStatus = statusFilter === 'all' || listing.status === statusFilter;

      if (statusFilter === 'needs-action') {
        matchesStatus = isSellerListingNeedsAction(listing, {
          network: this.props.network,
        });
      }

      if (statusFilter === 'preparing') {
        matchesStatus = preparing.has(listing.status);
      }

      if (statusFilter === 'cancelled') {
        matchesStatus = cancelled.has(listing.status);
      }

      return matchesQuery && matchesStatus;
    });

    return [...filtered].sort((a, b) => {
      const nameCompare = this.getListingName(a).localeCompare(
        this.getListingName(b),
        undefined,
        { numeric: true, sensitivity: 'base' },
      );

      if (sort === 'name-desc') return -nameCompare;
      if (sort === 'status') {
        const statusCompare = String(a.status).localeCompare(String(b.status));
        return statusCompare || nameCompare;
      }

      if (sort === 'price-asc' || sort === 'price-desc') {
        const aPrice = this.getListingSortPrice(a);
        const bPrice = this.getListingSortPrice(b);
        const priceCompare = aPrice - bPrice;
        return sort === 'price-asc'
          ? priceCompare || nameCompare
          : -priceCompare || nameCompare;
      }

      if (sort === 'expires-asc' || sort === 'expires-desc') {
        const expiryCompare = this.getListingExpiryTime(a) - this.getListingExpiryTime(b);
        return sort === 'expires-asc'
          ? expiryCompare || nameCompare
          : -expiryCompare || nameCompare;
      }

      return nameCompare;
    });
  }

  clearListingsFilters = () => this.setState({
    listingsQuery: '',
    listingsStatusFilter: 'all',
    listingsSort: 'name-asc',
  });

  submitGeneratedBulkListings = async (succeededNames, refreshedListings) => {
    const submitted = [];
    const submitFailures = [];

    if (
      !succeededNames.length
      || this.props.network !== 'main'
      || !this.canUseMarketplaceActions()
    ) {
      return {
        submitted,
        submitFailures,
      };
    }

    const feeInfo = await shakedex.getFeeInfo();
    if (feeInfo.rate !== 0) {
      return {
        submitted,
        submitFailures,
        skippedReason: 'The Shakedex channel requires a fee confirmation. Use Submit on each generated proof to review and confirm the fee.',
      };
    }

    const succeededNameSet = new Set(succeededNames);
    const listingsToSubmit = (refreshedListings || [])
      .filter(listing => (
        listing
        && listing.nameLock
        && succeededNameSet.has(listing.nameLock.name)
        && listing.status === LISTING_STATUS.ACTIVE
        && listing.auction
        && !listing.marketSubmission
      ));

    this.setState({
      bulkSubmittingNames: listingsToSubmit
        .map(listing => listing.nameLock && listing.nameLock.name)
        .filter(Boolean),
    });

    for (const listing of listingsToSubmit) {
      try {
        await this.props.submitToShakedex(listing.auction);
        submitted.push(listing.nameLock.name);
      } catch (e) {
        submitFailures.push({
          name: listing.nameLock && listing.nameLock.name,
          message: e.message,
        });
      }
    }

    return {
      submitted,
      submitFailures,
    };
  }

  generateReadyListings = async () => {
    const readyListings = this.getReadyToGenerateListings();

    if (!readyListings.length || this.state.isGeneratingReadyListings) {
      return;
    }

    const confirmed = window.confirm(
      `${this.context.t(this.props.network === 'main' ? 'generateAndSubmitReadyListingsConfirm' : 'generateReadyListingsConfirm')} ${readyListings.map(l => formatName(l.nameLock.name)).join(', ')}`,
    );

    if (!confirmed) {
      return;
    }

    const generatingNames = readyListings.map(l => l.nameLock && l.nameLock.name).filter(Boolean);

    this.setState({
      isGeneratingReadyListings: true,
      bulkGeneratingNames: generatingNames,
      bulkGenerateNotice: null,
    });

    try {
      const result = await this.props.launchExchangeAuctionsBulk(readyListings);
      const refreshedListings = result && result.listings && result.listings.length
        ? result.listings
        : await this.refreshLocalListings();
      if (result) {
        const succeeded = result.succeeded || [];
        const failures = result.failures || [];
        let submitted = [];
        let submitFailures = [];
        let skippedReason = '';

        try {
          const submitResult = await this.submitGeneratedBulkListings(succeeded, refreshedListings);
          submitted = submitResult.submitted || [];
          submitFailures = submitResult.submitFailures || [];
          skippedReason = submitResult.skippedReason || '';
        } catch (e) {
          skippedReason = e.message || 'Generated proofs, but automatic submit could not start. Use Submit on each generated proof.';
        }

        await this.refreshLocalListings();
        const remainingCount = this.getReadyToGenerateListings().length;
        this.setState({
          bulkGenerateNotice: {
            type: failures.length || submitFailures.length || skippedReason ? 'warning' : 'success',
            message: [
              submitted.length ? `Listed on Shakedex: ${submitted.map(formatName).join(', ')}.` : null,
              succeeded.length && !submitted.length ? `Proof ready: ${succeeded.map(formatName).join(', ')}. Use Submit to confirm each listing on Shakedex.` : null,
              failures.length ? `Failed: ${failures.map(f => formatName(f.name)).join(', ')}` : null,
              submitFailures.length ? `Submit failed: ${submitFailures.map(f => formatName(f.name)).join(', ')}` : null,
              skippedReason,
              remainingCount ? `${remainingCount} listing${remainingCount === 1 ? '' : 's'} still ready to generate.` : null,
            ].filter(Boolean).join(' '),
          },
        });
      }
    } finally {
      this.setState({
        isGeneratingReadyListings: false,
        bulkGeneratingNames: [],
        bulkSubmittingNames: [],
      });
    }
  }

  getDownloadableListingProofs() {
    return this.props.listings.filter(l => (
      l
      && l.status === LISTING_STATUS.ACTIVE
      && l.auction
    ));
  }

  clearMarketplaceFilters = () => {
    this.props.setAuctionPage(1);
    this.setState({
      marketplaceQuery: '',
      marketplaceAvailabilityFilter: 'available',
      marketplaceModeFilter: 'all',
      marketplaceSort: 'name',
    }, () => this.fetchShakedex('available'));
  };

  getMarketplaceAvailabilityItems() {
    const { t } = this.context;

    return [
      { label: t('availableNow'), value: 'available' },
      { label: t('allListings'), value: 'all' },
      { label: t('pending'), value: 'pending' },
    ];
  }

  getMarketplaceModeItems() {
    const { t } = this.context;

    return [
      { label: t('allListingTypes'), value: 'all' },
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
    const availability = this.state.marketplaceAvailabilityFilter;
    const mode = this.state.marketplaceModeFilter;
    const sort = this.state.marketplaceSort;

    const filtered = this.props.auctions.filter((auction) => {
      const matchesQuery = !query || auction.name.toLowerCase().includes(query);
      const isPending = isPendingAuction(auction);
      const matchesAvailability = availability === 'all'
        || (availability === 'available' && !isPending)
        || (availability === 'pending' && isPending);
      const isFixed = isFixedPriceAuction(auction);
      const matchesMode = mode === 'all'
        || (isPending && mode === 'fixed' && auction.listingMode === 'fixed-price')
        || (mode === 'fixed' && isFixed)
        || (mode === 'reverse' && !isFixed && !isPending);

      return matchesQuery && matchesAvailability && matchesMode;
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

    const currentBid = getBuyableBid(auction, await getCurrentBid(auction));
    const currentBidsMap = this.state.currentBidsMap;
    currentBidsMap.set(auction.id, currentBid);
    this.setState({currentBidsMap});
  }

  handleFulfillAuctionDeeplink = async () => {
    if (this.state.isHandlingFulfillAuctionDeeplink) {
      traceDeeplink('exchange-deeplink-skip-busy');
      return;
    }

    const { presignJSONString, name } = this.props.deeplinkParams || {};
    if (!presignJSONString) {
      traceDeeplink('exchange-deeplink-no-presign', {
        path: this.props.location && this.props.location.pathname,
        paramsKeys: Object.keys(this.props.deeplinkParams || {}),
      });
      return;
    }

    traceDeeplink('exchange-deeplink-start', {
      name,
      presignLength: presignJSONString.length,
      network: this.props.network,
      isMarketplaceVisible: this.isMarketplaceVisible(),
    });

    this.setState({
      isHandlingFulfillAuctionDeeplink: true,
      deeplinkAuctionName: name || '',
    });

    try {
      this.props.clearDeeplinkParams();
      const auction = fromAuctionJSON(JSON.parse(presignJSONString));
      if (isAuctionExpired(auction)) {
        throw new Error(this.context.t('shakedexListingExpired'));
      }
      const currentBid = getBuyableBid(auction, await getCurrentBid(auction));

      if (!currentBid) {
        traceDeeplink('exchange-deeplink-no-current-bid', {
          name,
          expired: isAuctionExpired(auction),
        });
        this.props.showError(
          isAuctionExpired(auction)
            ? this.context.t('shakedexListingExpired')
            : this.context.t('shakedexListingUnavailable'),
        );
        return;
      }

      this.setState({
        placingAuction: auction,
        placingCurrentBid: currentBid,
        placingAuctionSource: 'deeplink',
        isUploadingFile: false,
      });
      traceDeeplink('exchange-deeplink-modal-ready', {
        name: auction.name,
        bidPrice: currentBid.price,
      });
    } catch (e) {
      this.props.clearDeeplinkParams();
      traceDeeplink('exchange-deeplink-error', {
        name,
        message: e.message,
        stack: e.stack,
      });
      this.props.showError(e.message);
    } finally {
      this.setState({
        isHandlingFulfillAuctionDeeplink: false,
        deeplinkAuctionName: '',
      });
    }
  };

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
      if (isAuctionExpired(auction)) {
        throw new Error(this.context.t('shakedexListingExpired'));
      }
      const currentBid = getBuyableBid(auction, await getCurrentBid(auction));

      if (currentBid === null) {
        throw new Error('No bids available right now.');
      }

      this.setState({
        placingAuction: auction,
        placingCurrentBid: currentBid,
        placingAuctionSource: 'file',
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
      this.downloadJSON(`${submission.name}-presigns.json`, content);
    } catch (e) {
      logger.error(e.message);
      setTimeout(() => {
        throw e;
      }, 0);
    }
  };

  onDownloadAllListingProofs = async () => {
    try {
      const listings = this.getDownloadableListingProofs();
      if (!listings.length) {
        this.props.showError('No generated listing proofs are available to download.');
        return;
      }

      const content = JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        walletId: this.props.walletId,
        proofs: listings.map(listing => listing.auction),
      }, null, 2);
      const date = moment().format('YYYY-MM-DD');
      const walletLabel = walletFileLabel(this.props.walletId, this.props.walletsDetails);
      this.downloadJSON(`bob-shakedex-listing-proofs-${walletLabel}-${date}.json`, content);
    } catch (e) {
      logger.error(e.message);
      setTimeout(() => {
        throw e;
      }, 0);
    }
  };

  onDownloadMarketplaceBackup = async () => {
    const { t } = this.context;
    this.setState({ isBackingUpMarketplaceData: true });

    try {
      const [storedListings, storedFills] = await Promise.all([
        shakedex.getListings(),
        shakedex.getFulfillments(),
      ]);
      const listings = storedListings.length ? storedListings : this.props.listings;
      const fills = storedFills.length ? storedFills : this.props.fulfillments;
      const data = JSON.stringify({listings, fills}, null, 2);
      const date = moment().format('YYYY-MM-DD');
      const walletLabel = walletFileLabel(this.props.walletId, this.props.walletsDetails);
      const savePath = dialog.showSaveDialogSync({
        defaultPath: `bob-shakedex-marketplace-backup-${walletLabel}-${date}.json`,
        filters: [{name: 'exchange-listing', extensions: ['json']}],
      });

      if (!savePath) {
        return;
      }

      await fs.promises.writeFile(savePath, data);
      this.props.showSuccess(t('backupMarketplaceDataSuccess'));
    } catch (e) {
      logger.error(e.message);
      this.props.showError(e.message);
    } finally {
      this.setState({ isBackingUpMarketplaceData: false });
    }
  };

  downloadJSON = (filename, content) => {
    const blob = new Blob([`${content}\r\n`], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link); // Required for FF
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  openPrivateSaleModal = (listing) => {
    this.setState({
      privateSaleListing: listing,
      privateSalePrice: '',
      privateSaleDurationIdx: PRIVATE_SALE_DURATION_OPTS.indexOf(DEFAULT_PRIVATE_SALE_DURATION_DAYS),
      privateSaleError: '',
    });
  };

  closePrivateSaleModal = () => {
    if (this.state.isCreatingPrivateProof) {
      return;
    }

    this.setState({
      privateSaleListing: null,
      privateSalePrice: '',
      privateSaleError: '',
    });
  };

  onCreatePrivateSaleProof = async () => {
    const listing = this.state.privateSaleListing;
    if (!listing) {
      return;
    }

    try {
      this.setState({
        isCreatingPrivateProof: true,
        privateSaleError: '',
      });

      const privateProof = await this.props.createPrivateSaleProof(
        listing.nameLock,
        {
          mode: 'fixed',
          price: Math.round(Number(this.state.privateSalePrice) * 1e6),
          durationDays: PRIVATE_SALE_DURATION_OPTS[this.state.privateSaleDurationIdx],
        },
      );

      if (privateProof && privateProof.auction) {
        this.downloadPrivateProof(privateProof, listing.nameLock.name);
      }

      this.setState({
        privateSaleListing: null,
        privateSalePrice: '',
      });
    } catch (e) {
      this.setState({
        privateSaleError: e.message,
      });
    } finally {
      this.setState({
        isCreatingPrivateProof: false,
      });
    }
  };

  downloadPrivateProof = (privateProof, name) => {
    const walletLabel = walletFileLabel(this.props.walletId, this.props.walletsDetails);
    const safeName = toSafeFilenamePart(name || privateProof?.auction?.name || 'shakedex', 'shakedex');
    this.downloadJSON(
      `${safeName}-private-sale-proof-${walletLabel}-${privateProof.createdAt || Date.now()}.json`,
      JSON.stringify(privateProof.auction),
    );
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
      this.downloadJSON(`${submission.name}-presigns.json`, content);
    } catch (e) {
      logger.error(e.message);
      setTimeout(() => {
        throw e;
      }, 0);
    }
  };

  onClickSubmitShakedex = async (listing) => {
    this.setState({
      submitConfirmationListing: listing,
      submitListingError: '',
    });
  };

  submitListingProof = async (listing, {showInlineError = false} = {}) => {
    if (!listing) {
      return;
    }

    this.setState({
      isSubmittingListingProof: true,
      submitListingError: '',
    });

    try {
      const feeInfo = await shakedex.getFeeInfo();

      if (feeInfo.rate === 0) {
        await this.props.submitToShakedex(listing.auction);
        this.setState({
          submitConfirmationListing: null,
          isSubmittingListingProof: false,
        });
        return;
      }

      this.setState({
        submitConfirmationListing: null,
        isSubmittingListingProof: false,
        isShowingFeeConfirmationFor: listing,
        feeInfo,
      });
    } catch (e) {
      if (!showInlineError && !e.wasShown) {
        this.props.showError(e.message || 'The listing proof could not be submitted. Please try again.');
      }
      this.setState({
        isSubmittingListingProof: false,
        submitListingError: showInlineError
          ? e.message || 'The listing proof could not be submitted. Please try again.'
          : '',
      });
    }
  };

  submitConfirmedListing = async () => {
    await this.submitListingProof(this.state.submitConfirmationListing, {
      showInlineError: true,
    });
  };

  onListingProofGenerated = async (name, {
    generatedListing,
    submitAfterGenerate = false,
  } = {}) => {
    this.setState(prevState => ({
      preparingSubmitNames: prevState.preparingSubmitNames.includes(name)
        ? prevState.preparingSubmitNames
        : [...prevState.preparingSubmitNames, name],
    }));

    if (!submitAfterGenerate) {
      return;
    }

    if (this.props.network !== 'main') {
      this.props.showSuccess('Listing proof generated. Submit is only automatic for mainnet Shakedex channel listings.');
      return;
    }

    if (!this.canUseMarketplaceActions()) {
      this.props.showError(`${this.getMarketplaceNotReadyMessage()} The proof is ready; use Submit after the marketplace is ready.`);
      return;
    }

    const listing = generatedListing || this.props.listings.find(l => (
      l
      && l.nameLock
      && l.nameLock.name === name
    ));

    if (!listing || !listing.auction) {
      this.props.showError('Listing proof generated, but Bob could not find the refreshed proof to submit. Use Submit on the listing row after it refreshes.');
      return;
    }

    await this.submitListingProof(listing);
  };

  renderSubmitConfirmationModal() {
    const listing = this.state.submitConfirmationListing;
    if (!listing) {
      return null;
    }

    const {t} = this.context;
    const expiryTime = getAuctionExpiryTime(listing.auction);
    const listingMode = listing.params.mode || 'reverse';
    const isFixedPrice = listingMode === 'fixed';
    const isShortProof = isShortFixedListingProof(listing);

    return (
      <MiniModal
        title="Submit Listing Proof"
        onClose={() => {
          if (!this.state.isSubmittingListingProof) {
            this.setState({submitConfirmationListing: null});
          }
        }}
      >
        <p>
          This publishes your locally generated proof to the Shakedex channel so buyers can see and buy the listing.
        </p>
        {this.state.isSubmittingListingProof && (
          <div className="exchange-submit-confirmation__processing">
            {t('submittingListingProof')}
          </div>
        )}
        {this.state.submitListingError && (
          <div className="exchange-submit-confirmation__error">
            {this.state.submitListingError}
          </div>
        )}
        <div className="exchange-submit-confirmation__details">
          <div>
            <strong>Domain</strong>
            <span>{formatName(listing.nameLock.name)}</span>
          </div>
          <div>
            <strong>Listing Type</strong>
            <span>{isFixedPrice ? t('buyNow') : t('reverseAuction')}</span>
          </div>
          <div>
            <strong>{isFixedPrice ? 'Buy Now Price' : 'Price Range'}</strong>
            <span>
              {isFixedPrice
                ? `${displayBalance(listing.params.price)} HNS`
                : `${displayBalance(listing.params.startPrice)} -> ${displayBalance(listing.params.endPrice)} HNS`}
            </span>
          </div>
          <div>
            <strong>Buyable Until</strong>
            <span>{expiryTime ? moment(expiryTime).utc().format('YYYY-MM-DD HH:mm [UTC]') : 'Unknown'}</span>
          </div>
        </div>
        <p className="exchange-submit-confirmation__note">
          No on-chain transaction is sent by this step. You can still Download the proof as a backup.
        </p>
        {isShortProof && (
          <div className="exchange-submit-confirmation__warning">
            This proof expires in less than 30 days. To make a longer fixed-price listing, click Cancel, then Regenerate and choose a longer listing length before submitting.
          </div>
        )}
        <div className="place-bid-modal__buttons">
          <button
            className="place-bid-modal__cancel"
            onClick={() => this.setState({submitConfirmationListing: null})}
            disabled={this.state.isSubmittingListingProof}
          >
            {t('cancel')}
          </button>
          <button
            className="place-bid-modal__send"
            onClick={this.submitConfirmedListing}
            disabled={this.state.isSubmittingListingProof}
          >
            {this.state.isSubmittingListingProof ? t('submitting') : t('submit')}
          </button>
        </div>
      </MiniModal>
    );
  }

  renderPrivateSaleModal() {
    const listing = this.state.privateSaleListing;
    if (!listing) {
      return null;
    }

    const {t} = this.context;
    const isValid = String(this.state.privateSalePrice).length
      && Number(this.state.privateSalePrice) > 0;
    const publicPrice = listing.params && listing.params.mode === 'fixed'
      ? Number(listing.params.price || 0)
      : null;
    const privatePrice = Math.round(Number(this.state.privateSalePrice || 0) * 1e6);
    const isLowerThanPublic = publicPrice && privatePrice > 0 && privatePrice < publicPrice;

    return (
      <MiniModal
        title={t('privateShakedexSale')}
        onClose={this.closePrivateSaleModal}
        className="exchange__create-listing-modal exchange__private-sale-modal"
      >
        <div className="exchange__place-listing-modal">
          <p>
            {t('privateSaleProofIntro')}
          </p>
          <div className="exchange-submit-confirmation__warning">
            {t('privateSaleProofNotBuyerRestricted')}
          </div>
          <div className="exchange-submit-confirmation__warning">
            {t('privateSaleProofRaceWarning')}
          </div>
          {isLowerThanPublic && (
            <div className="exchange-submit-confirmation__warning">
              {t('privateSaleLowerThanPublicWarning')}
            </div>
          )}
          {this.state.privateSaleError && (
            <div className="exchange-submit-confirmation__error">
              {this.state.privateSaleError}
            </div>
          )}

          <label className="exchange__label">{`${t('listingName')}:`}</label>
          <div className="exchange__input">
            {formatName(listing.nameLock.name)}
          </div>

          <label className="exchange__label">{`${t('privateSalePrice')}:`}</label>
          <div className="exchange__input send__input">
            <input
              type="number"
              value={this.state.privateSalePrice}
              onChange={(e) => this.setState({
                privateSalePrice: e.target.value,
                privateSaleError: '',
              })}
            />
          </div>

          <label className="exchange__label">{`${t('duration')}:`}</label>
          <Dropdown
            items={PRIVATE_SALE_DURATION_OPTS.map(d => ({
              label: `${d} ${t('days')}`,
            }))}
            onChange={(privateSaleDurationIdx) => this.setState({
              privateSaleDurationIdx,
              privateSaleError: '',
            })}
            currentIndex={this.state.privateSaleDurationIdx}
          />

          <div className="place-bid-modal__buttons">
            <button
              className="place-bid-modal__cancel"
              onClick={this.closePrivateSaleModal}
              disabled={this.state.isCreatingPrivateProof}
            >
              {t('cancel')}
            </button>
            <button
              className="place-bid-modal__send"
              onClick={this.onCreatePrivateSaleProof}
              disabled={!isValid || this.state.isCreatingPrivateProof}
            >
              {this.state.isCreatingPrivateProof ? t('generating') : t('generatePrivateProof')}
            </button>
          </div>
        </div>
      </MiniModal>
    );
  }

  renderListingStatus(status, listing = {}) {
    let statusText = status;
    const {t} = this.context;

    const i18nKey = listingStatusToI18nKey(status);

    if (i18nKey)
      statusText = t(i18nKey);

    if (status === LISTING_STATUS.TRANSFER_CONFIRMED_LOCKUP && listing.blocksUntilFinalize > 0) {
      statusText = `${statusText} (${listing.blocksUntilFinalize} ${t('blocks')})`;
    }

    if (status === LISTING_STATUS.ACTIVE) {
      statusText = listing.marketSubmission
        ? t('listedOnShakedex')
        : t('proofReady');
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
          LISTING_STATUS.SALE_PENDING,
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

    const isSpv = this.props.spv;
    const showSellerListings = !isSpv || ENABLE_SPV_SELLER_BETA;
    const marketplaceAuctions = this.getVisibleMarketplaceAuctions();
    const marketplaceView = getMarketplaceViewState(
      this.props.marketplaceStatus,
      this.props.auctions.length,
    );
    const activeChannelText = this.state.marketChannelHost;
    const marketBaseUrl = getShakedexChannelBaseUrl({host: this.state.marketChannelHost});
    const downloadableListingProofs = this.getDownloadableListingProofs();
    const readyToGenerateListings = this.getReadyToGenerateListings();
    const listingsNeedingAction = this.props.listings.filter(listing => (
      isSellerListingNeedsAction(listing, {network: this.props.network})
    ));
    const visibleListings = this.getVisibleListings();
    const listingStatusItems = this.getListingsStatusItems();
    const listingSortItems = this.getListingsSortItems();

    return (
      <div className="exchange">
        {this.state.isHandlingFulfillAuctionDeeplink && (
          <div className="exchange-deeplink-loading">
            <div className="loader" style={{ backgroundImage: `url(${SpinnerSVG})`}} />
            <div>
              <strong>Opening Shakedex buy{this.state.deeplinkAuctionName ? ` for ${formatName(this.state.deeplinkAuctionName)}` : ''}...</strong>
              <span>Bob is reading the listing proof and preparing the confirmation modal.</span>
            </div>
          </div>
        )}
        {this.isMarketplaceVisible() && this.renderReadinessPanel()}
        {this.isMarketplaceVisible() ? <>
          <div className="exchange-marketplace-header">
            <div>
              <h2>{t('learnHnsMarketplace')}</h2>
              <div className="exchange-marketplace-header__channel">
                {`${t('activeChannel')}: ${activeChannelText}`}
              </div>
            </div>
            <div className="exchange-marketplace-header__actions">
              <button
                className="exchange-marketplace-header__button"
                disabled={
                  this.props.marketplaceStatus === MARKETPLACE_STATUS.LOADING
                  || this.state.marketStatusLoading
                }
                onClick={this.refreshMarketplace}
              >
                {t('refresh')}
              </button>
              <button
                className="exchange-marketplace-header__button"
                onClick={() => shell.openExternal(`${marketBaseUrl}/sold`)}
              >
                {t('openMarketHistory')}
              </button>
              <Link
                className="exchange-marketplace-header__button"
                to="/settings/exchange"
              >
                {t('learnMore')}
              </Link>
            </div>
          </div>
          {this.renderMarketplaceFilters(marketplaceAuctions.length)}
          <Table className="exchange-table">
            <Header />
            {marketplaceView.showInitialLoading && (
              <TableRow>
                <div className="loader" style={{ backgroundImage: `url(${SpinnerSVG})`}} />
              </TableRow>
            )}
            {marketplaceView.showRefreshing && (
              <TableRow>
                <TableItem>{t('refreshingMarketplaceListings')}</TableItem>
              </TableRow>
            )}
            {!!marketplaceAuctions.length && marketplaceAuctions.map(this.renderAuctionRow)}
            {this.renderListingControls()}
            {marketplaceView.showEmpty && (
              <TableRow>
                <TableItem>
                  {t('marketplaceLoadedEmpty')}
                </TableItem>
              </TableRow>
            )}
            {
              this.props.marketplaceStatus === MARKETPLACE_STATUS.LOADED
              && this.props.auctions.length > 0
              && !marketplaceAuctions.length
              && (
                <TableRow>
                  <TableItem>{t('noMarketplaceListingsFound')}</TableItem>
                </TableRow>
              )
            }
            {marketplaceView.showError && (
              <div className="exchange-marketplace-error" role="alert">
                <strong>
                  {this.props.marketplaceStatus === MARKETPLACE_STATUS.TIMEOUT
                    ? t('marketplaceRequestTimedOut')
                    : t('marketplaceServerError')}
                </strong>
                <span>{this.props.marketplaceError}</span>
                <button
                  className="exchange-marketplace-header__button"
                  onClick={this.fetchShakedex.bind(this)}
                >
                  {t('retry')}
                </button>
              </div>
            )}
          </Table>
        </> : null}
        {showSellerListings && (
          <>
            <div className="exchange__button-header" ref={this.sellerListingsRef}>
              <h2>{t('yourListings')}</h2>
              <div className="exchange__button-header-actions">
                {!!listingsNeedingAction.length && (
                  <button
                    className="exchange__button-header-button exchange__button-header-button--secondary"
                    onClick={() => this.setState({listingsStatusFilter: 'needs-action'})}
                  >
                    {`${t('sellerListingsNeedsAction')} (${listingsNeedingAction.length})`}
                  </button>
                )}
                {!!readyToGenerateListings.length && (
                  <button
                    className="exchange__button-header-button exchange__button-header-button--secondary"
                    disabled={this.state.isGeneratingReadyListings}
                    onClick={this.generateReadyListings}
                  >
                    {this.state.isGeneratingReadyListings
                      ? this.state.bulkSubmittingNames.length
                        ? `${t('submitting')} ${this.state.bulkSubmittingNames.length} proof${this.state.bulkSubmittingNames.length === 1 ? '' : 's'}...`
                        : `${t('generating')} ${this.state.bulkGeneratingNames.length} proof${this.state.bulkGeneratingNames.length === 1 ? '' : 's'}...`
                      : `${t(this.props.network === 'main' ? 'generateAndSubmitReadyListings' : 'generateReadyListings')} (${readyToGenerateListings.length})`}
                  </button>
                )}
                <button
                  className="exchange__button-header-button exchange__button-header-button--secondary"
                  disabled={this.state.isBackingUpMarketplaceData}
                  title={t('backupMarketplaceDataHelp')}
                  aria-label={t('backupMarketplaceDataHelp')}
                  onClick={this.onDownloadMarketplaceBackup}
                >
                  {this.state.isBackingUpMarketplaceData
                    ? `${t('backingUp')}...`
                    : t('backupMarketplaceData')}
                </button>
                <button
                  className="exchange__button-header-button exchange__button-header-button--secondary"
                  disabled={this.state.isLoadingLocalListings || !downloadableListingProofs.length}
                  title={t('downloadAllListingProofsHelp')}
                  aria-label={t('downloadAllListingProofsHelp')}
                  onClick={this.onDownloadAllListingProofs}
                >
                  {`${t('downloadAllListingProofs')} (${downloadableListingProofs.length})`}
                </button>
                <button
                  className="exchange__button-header-button exchange__button-header-button--secondary"
                  onClick={this.refreshLocalListings}
                >
                  {this.state.isLoadingLocalListings ? `${t('refreshing')}...` : t('refresh')}
                </button>
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
            </div>
            <ShakedexDeprecated toggle={this.state.shakedexDeprecatedToggle} />
            <div className="exchange__button-header__sub">
              <span>{t('proofBackupWarning')}</span>
              <Link className="exchange__backup-link" to="/settings/exchange/backup">
                {t('marketplaceBackupSettings')}
              </Link>
              <button
                className="exchange__backup-link exchange__backup-link--button"
                type="button"
                onClick={() => shell.openExternal('https://shakedex.org/docs#seller-backups')}
              >
                {t('proofBackupDocs')}
              </button>
            </div>
            {this.state.bulkGenerateNotice && (
              <div className={`exchange-bulk-generate-notice exchange-bulk-generate-notice--${this.state.bulkGenerateNotice.type}`}>
                {this.state.bulkGenerateNotice.message}
              </div>
            )}
            <div className="exchange-listing-filters">
              <div className="exchange-listing-filters__search">
                <input
                  type="text"
                  value={this.state.listingsQuery}
                  placeholder={t('filterSellerListings')}
                  onChange={(e) => this.setState({ listingsQuery: e.target.value })}
                />
              </div>
              <Dropdown
                className="exchange-listing-filters__status"
                items={listingStatusItems}
                currentIndex={Math.max(
                  listingStatusItems.findIndex(item => item.value === this.state.listingsStatusFilter),
                  0,
                )}
                onChange={(listingsStatusFilter) => this.setState({ listingsStatusFilter })}
              />
              <Dropdown
                className="exchange-listing-filters__sort"
                items={listingSortItems}
                currentIndex={Math.max(
                  listingSortItems.findIndex(item => item.value === this.state.listingsSort),
                  0,
                )}
                onChange={(listingsSort) => this.setState({ listingsSort })}
              />
              <div className="exchange-listing-filters__count">
                {`${visibleListings.length} / ${this.props.listings.length} ${this.props.listings.length === 1 ? t('listing') : t('listings')}`}
              </div>
              {(this.state.listingsQuery || this.state.listingsStatusFilter !== 'all' || this.state.listingsSort !== 'name-asc') && (
                <button
                  className="exchange-listing-filters__clear"
                  onClick={this.clearListingsFilters}
                >
                  {t('clearFilters')}
                </button>
              )}
            </div>
            <Table className="exchange-table exchange-table--listings">
              <HeaderRow>
                <HeaderItem>{t('domain')}</HeaderItem>
                <HeaderItem>{t('status')}</HeaderItem>
                <HeaderItem>{t('listingType')}</HeaderItem>
                <HeaderItem>{t('price')}</HeaderItem>
                <HeaderItem>Expires</HeaderItem>
                <HeaderItem />
              </HeaderRow>
              {this.state.isLoadingLocalListings && (
                <TableRow>
                  <TableItem>
                    <div className="exchange-table__empty-note">
                      {t('checkingLocalListings')}
                    </div>
                  </TableItem>
                </TableRow>
              )}
              {!this.state.isLoadingLocalListings && !this.props.listings.length && (
                <TableRow className="exchange-table__empty-row">
                  <TableItem className="exchange-table__empty-cell">
                    <div className="exchange-table__empty-note">
                      <strong>{t('noLocalListingsLoaded')}</strong>
                      <span>{t('noLocalListingsLoadedHelp')}</span>
                    </div>
                  </TableItem>
                </TableRow>
              )}
              {!this.state.isLoadingLocalListings && !!this.props.listings.length && !visibleListings.length && (
                <TableRow className="exchange-table__empty-row">
                  <TableItem className="exchange-table__empty-cell">
                    <div className="exchange-table__empty-note">
                      <strong>{t('noSellerListingsMatch')}</strong>
                      <span>{t('noSellerListingsMatchHelp')}</span>
                    </div>
                  </TableItem>
                </TableRow>
              )}
              {!this.state.isLoadingLocalListings && !!visibleListings.length && visibleListings.map((l, i) => this.renderListingRow(l, i))}
            </Table>
          </>
        )}
        {(!isSpv || this.isMarketplaceVisible()) && (
          <>
            <div className="exchange__button-header">
              <h2>{t('yourFills')}</h2>
              <button
                className="exchange__button-header-button extension_cta_button"
                onClick={this.onUploadPresigns}
              >
                {t('loadAuctionFile')}
              </button>
              <button
                className="exchange__button-header-button exchange__button-header-button--secondary"
                onClick={this.onUploadPresigns}
              >
                {t('loadPrivateSaleProof')}
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
                          {this.props.finalizingName === f.fulfillment.name ? 'Finalizing...' : 'Finalize'}
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
        {this.state.placingAuction && this.state.placingCurrentBid && (
          <PlaceBidModal
            auction={this.state.placingAuction}
            bid={this.state.placingCurrentBid}
            onClose={() => this.setState({
              placingAuction: null,
              placingCurrentBid: null,
              placingAuctionSource: null,
            })}
            isPrivateProof={this.state.placingAuctionSource === 'file'}
          />
        )}
        {this.state.isPlacingListing && (
          <PlaceListingModal
            initialName={this.state.initialListingName}
            onClose={() => this.setState({
              isPlacingListing: false,
              initialListingName: '',
            })}
          />
        )}
        {this.state.isGeneratingListing && (
          <GenerateListingModal
            listing={this.state.generatingListing}
            canSubmitAfterGenerate={this.props.network === 'main'}
            onProofGenerated={this.onListingProofGenerated}
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
        {this.renderSubmitConfirmationModal()}
        {this.renderPrivateSaleModal()}
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
    const availabilityItems = this.getMarketplaceAvailabilityItems();
    const modeItems = this.getMarketplaceModeItems();
    const sortItems = this.getMarketplaceSortItems();
    const currentAvailabilityIndex = availabilityItems.findIndex(
      item => item.value === this.state.marketplaceAvailabilityFilter,
    );
    const currentModeIndex = modeItems.findIndex(item => item.value === this.state.marketplaceModeFilter);
    const currentSortIndex = sortItems.findIndex(item => item.value === this.state.marketplaceSort);
    const isFiltered = Boolean(this.state.marketplaceQuery.trim())
      || this.state.marketplaceAvailabilityFilter !== 'available'
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
          className="exchange-marketplace-filters__availability"
          items={availabilityItems}
          currentIndex={Math.max(currentAvailabilityIndex, 0)}
          onChange={(marketplaceAvailabilityFilter) => {
            this.props.setAuctionPage(1);
            this.setState({ marketplaceAvailabilityFilter }, () => {
              this.fetchShakedex(marketplaceAvailabilityFilter);
            });
          }}
        />
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
    const marketStatusDetails = [
      marketStatus?.height ? `${t('height')}: ${marketStatus.height}` : null,
      marketStatus?.version ? `${t('version')}: ${marketStatus.version}` : null,
    ].filter(Boolean).join(' · ');
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
            {[
              `${t('marketStatusChecked')} ${moment(marketStatusCheckedAt).format('HH:mm:ss')}`,
              marketStatusDetails,
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    );
  }

  renderDisabledListingAction(label, title) {
    return (
      <div
        className="bid-action__link bid-action__link--disabled"
        title={title}
        aria-disabled="true"
      >
        {label}
      </div>
    );
  }

  renderPrivateProofActions(listing) {
    const privateProofs = Array.isArray(listing.privateProofs)
      ? listing.privateProofs
      : [];

    if (!privateProofs.length) {
      return null;
    }

    return privateProofs.map((privateProof, i) => (
      <div
        key={`${privateProof.createdAt || i}`}
        className="bid-action__link"
        title={this.context.t('downloadPrivateProofHelp')}
        aria-label={this.context.t('downloadPrivateProofHelp')}
        onClick={() => this.downloadPrivateProof(privateProof, listing.nameLock.name)}
      >
        {`${this.context.t('privateProof')} ${displayBalance(privateProof.price, true)}`}
      </div>
    ));
  }

  renderListingRow = (l, idx) => {
    const { auction, deprecated, lowestDeprecatedPrice } = l;
    const listingMode = l.params.mode || 'reverse';
    const { data = [] } = auction || {};
    const lastBid = data[data.length - 1];
    const { lockTime = 0 } = lastBid || {}
    const now = Date.now();
    const hasLastBidReleased = now > lockTime * 1000;
    const isBulkGenerating = this.state.bulkGeneratingNames.includes(l.nameLock.name);
    const isPreparingSubmit = this.state.preparingSubmitNames.includes(l.nameLock.name);
    const expiryLabel = getAuctionExpiryLabel(l.auction);
    const isSold = l.status === LISTING_STATUS.SOLD;
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
          <span
            className={classNames('exchange-listing-expiry', {
              'exchange-listing-expiry--short': isShortFixedListingProof(l),
              'exchange-listing-expiry--sold': isSold,
            })}
            title={isSold
              ? t('soldListingNoExpiryHelp')
              : l.auction
                ? `Buyable until ${expiryLabel}`
                : 'Generate a proof to set the listing length.'}
          >
            {isSold ? t('notApplicable') : expiryLabel}
          </span>
        </TableItem>
        <TableItem className="exchange-table__actions-cell">
          {isPreparingSubmit && (
            <div className="bid-action">
              {this.renderDisabledListingAction(
                `${t('preparingSubmit')}...`,
                t('preparingSubmitHelp'),
              )}
              {this.renderDisabledListingAction(
                t('download'),
                t('preparingSubmitHelp'),
              )}
              {this.renderDisabledListingAction(
                t('submit'),
                t('preparingSubmitHelp'),
              )}
            </div>
          )}
          {!isPreparingSubmit && l.status === LISTING_STATUS.SALE_PENDING && (
            <div className="bid-action">
              {this.renderDisabledListingAction(
                t('salePending'),
                t('salePendingHelp'),
              )}
            </div>
          )}
          {!isPreparingSubmit && l.status === LISTING_STATUS.TRANSFER_CONFIRMED && (
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
          {!isPreparingSubmit && l.status === LISTING_STATUS.FINALIZE_CONFIRMED && (
            <div className="bid-action">
              {isBulkGenerating
                ? this.renderDisabledListingAction(`${t('generating')}...`, 'Generating this listing proof now.')
                : (
                  <div
                    className="bid-action__link"
                    onClick={() => this.setState({
                      isGeneratingListing: true,
                      generatingListing: l,
                    })}
                  >
                    {t('generate')}
                  </div>
                )
              }
              {this.renderDisabledListingAction(
                t('download'),
                'Available after you generate the listing proof.'
              )}
              {this.renderDisabledListingAction(
                t('submit'),
                'Available after you generate the listing proof.'
              )}
              <div
                className="bid-action__link bid-action__link--private-proof"
                title={t('createPrivateSaleProofHelp')}
                aria-label={t('createPrivateSaleProofHelp')}
                onClick={() => this.openPrivateSaleModal(l)}
              >
                {t('createPrivateSaleProofAction')}
              </div>
              {this.renderPrivateProofActions(l)}
            </div>
          )}
          {!isPreparingSubmit && l.status === LISTING_STATUS.FINALIZE_CONFIRMING && (
            <div className="bid-action">
              {this.renderDisabledListingAction(
                t('generate'),
                'Available after the finalize transaction confirms on-chain.'
              )}
              {this.renderDisabledListingAction(
                t('download'),
                'Available after you generate the listing proof.'
              )}
              {this.renderDisabledListingAction(
                t('submit'),
                'Available after you generate the listing proof.'
              )}
            </div>
          )}
          {!isPreparingSubmit && l.status === LISTING_STATUS.CANCEL_CONFIRMED && (
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
          {!isPreparingSubmit && l.status === LISTING_STATUS.ACTIVE && (
            <div className="bid-action">
              {
                hasLastBidReleased && (
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
                title={t('downloadListingProofHelp')}
                aria-label={t('downloadListingProofHelp')}
                onClick={() => this.onDownloadPresigns(l)}
              >
                {t('download')}
              </div>
              <div
                className="bid-action__link bid-action__link--private-proof"
                title={t('createPrivateSaleProofHelp')}
                aria-label={t('createPrivateSaleProofHelp')}
                onClick={() => this.openPrivateSaleModal(l)}
              >
                {t('createPrivateSaleProofAction')}
              </div>
              {this.renderPrivateProofActions(l)}
              {this.props.network === 'main' && !l.marketSubmission && (
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
                    title={t('submitListingProofHelp')}
                    aria-label={t('submitListingProofHelp')}
                    onClick={() => this.canUseMarketplaceActions()
                      ? this.onClickSubmitShakedex(l)
                      : this.showMarketplaceNotReady()}
                  >
                    {t('submit')}
                  </div>
              )}
              {l.marketSubmission && (
                <div
                  className="bid-action__hint"
                  title={t('listedOnShakedexHelp')}
                  aria-label={t('listedOnShakedexHelp')}
                >
                  {t('submitted')}
                </div>
              )}

              <div
                className="bid-action__link"
                title={t('cancelListingHelp')}
                aria-label={t('cancelListingHelp')}
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
    const isPending = isPendingAuction(auction);
    const currentBid = this.state.currentBidsMap.get(auction.id);
    const buyableBid = getBuyableBid(auction, currentBid);
    const isFixedPrice = isFixedPriceAuction(auction);
    const isExpired = !isPending && isAuctionExpired(auction);
    const marketBaseUrl = getShakedexChannelBaseUrl({host: this.state.marketChannelHost});
    if (!isPending && currentBid === undefined) {
      this.getCurrentBidForAuction(auction);
    }

    const currentPriceText = isPending
      ? (auction.expectedPrice ? displayBalance(auction.expectedPrice, true) : t('priceComingSoon'))
      : (isExpired
        ? t('expired')
        : (buyableBid ? displayBalance(buyableBid.price, true) : t('shakedexListingUnavailable')));

    return (
      <TableRow
        key={auction.id}
        className="exchange__auction-listing__row"
        onClick={() => shell.openExternal(`${marketBaseUrl}${auction.url || `/listing/${auction.name}`}`)}
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
                    'bid-action__link--disabled': isPending || isExpired || !this.canUseMarketplaceActions(),
                  })}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isPending || isExpired) return;
                    if (!this.canUseMarketplaceActions()) {
                      this.showMarketplaceNotReady();
                      return;
                    }
                    if (!buyableBid) {
                      this.props.showError(t('shakedexListingUnavailable'));
                      return;
                    }
                    this.setState({
                      placingAuction: auction,
                      placingCurrentBid: buyableBid,
                      placingAuctionSource: 'market',
                    });
                  }}
                >
                  {isPending ? t('comingSoon') : (isExpired ? t('expired') : (isFixedPrice ? t('buyNow') : t('buyAtCurrentPrice')))}
                </div>
                {!isPending && (
                  <div
                    className="bid-action__link"
                    onClick={(e) => {
                      e.stopPropagation();
                      this.onClickDownload(auction);
                    }}
                  >
                    {t('downloadProofs')}
                  </div>
                )}
                <div
                  className="bid-action__link"
                  onClick={(e) => {
                    e.stopPropagation();
                    shell.openExternal(`${marketBaseUrl}${auction.url || `/listing/${auction.name}`}`);
                  }}
                >
                  {isPending ? t('viewPending') : t('viewListing')}
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

    if (isFixedPriceAuction(auction)) {
      return isAuctionExpired(auction) ? t('expired') : t('buyNow');
    }

    if (!currentBid) {
      return isAuctionExpired(auction) ? t('expired') : t('sold');
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
    if (isPendingAuction(auction)) {
      if (auction.blocksUntilFinalize > 0) {
        return `${this.context.t('pending')} (${auction.blocksUntilFinalize} ${this.context.t('blocks')})`;
      }

      return this.context.t('pending');
    }

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

function getFixedPriceBid(auction) {
  if (!isFixedPriceAuction(auction)) {
    return null;
  }

  const [bid] = auction.bids;
  return bid && typeof bid.price === 'number' ? bid : null;
}

function getBuyableBid(auction, currentBid) {
  return currentBid || getFixedPriceBid(auction);
}

function isPendingAuction(auction) {
  return isPendingMarketplaceAuction(auction);
}

function getKnownCurrentPrice(auction, currentBidsMap) {
  if (isPendingAuction(auction)) {
    return auction.expectedPrice || null;
  }

  const currentBid = currentBidsMap.get(auction.id);

  const buyableBid = getBuyableBid(auction, currentBid);

  if (!buyableBid) {
    return null;
  }

  return buyableBid.price;
}

export default connect(
  (state) => ({
    auctions: state.exchange.auctionIds.map(id => state.exchange.auctions[id]),
    total: state.exchange.total,
    currentPage: state.exchange.currentPage,
    marketplaceStatus: state.exchange.marketplaceStatus,
    marketplaceError: state.exchange.marketplaceError,
    fulfillments: state.exchange.fulfillments,
    listings: state.exchange.listings,
    finalizingName: state.exchange.finalizingName,
    deeplinkParams: state.app.deeplinkParams,
    walletType: state.wallet.type,
    walletWatchOnly: state.wallet.watchOnly,
    walletId: state.wallet.wid,
    walletsDetails: state.wallet.walletsDetails,
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
    getExchangeAuctions: (availability) => dispatch(getExchangeAuctions(availability)),
    getExchangeFullfillments: (page) => dispatch(getExchangeFullfillments(page)),
    getExchangeListings: (page) => dispatch(getExchangeListings(page)),
    finalizeExchangeBid: (fulfillment) => dispatch(finalizeExchangeBid(fulfillment)),
    finalizeExchangeLock: (nameLock) => dispatch(finalizeExchangeLock(nameLock)),
    cancelExchangeLock: (nameLock) => dispatch(cancelExchangeLock(nameLock)),
    finalizeCancelExchangeLock: (nameLock) => dispatch(finalizeCancelExchangeLock(nameLock)),
    launchExchangeAuction: (nameLock) => dispatch(launchExchangeAuction(nameLock)),
    launchExchangeAuctionsBulk: (listings) => dispatch(launchExchangeAuctionsBulk(listings)),
    createPrivateSaleProof: (nameLock, params) => dispatch(createPrivateSaleProof(nameLock, params)),
    submitToShakedex: (auction) => dispatch(submitToShakedex(auction)),
    showError: (errorMessage) => dispatch(showError(errorMessage)),
    showSuccess: (message) => dispatch(showSuccess(message)),
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

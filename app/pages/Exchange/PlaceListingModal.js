import React, { Component } from 'react';
import MiniModal from '../../components/Modal/MiniModal.js';
import { connect } from 'react-redux';
import { getMyNames } from '../../ducks/myDomains.js';
import Dropdown from '../../components/Dropdown';
import { transferExchangeLock } from '../../ducks/exchange.js';
import Anchor from "../../components/Anchor";
import Alert from "../../components/Alert";
import {I18nContext} from "../../utils/i18n";
import {getShakedexChannelBaseUrl} from '../../constants/shakedexChannels.js';
import * as networks from 'hsd/lib/protocol/networks';
import {formatName} from '../../utils/nameHelpers';
import {LISTING_STATUS} from '../../constants/exchange.js';

const MARKET_API_BASE_URL = getShakedexChannelBaseUrl();
const EXPIRING_SOON_BLOCKS = 30 * 24 * 6;

export class PlaceListingModal extends Component {
  static contextType = I18nContext;

  constructor(props) {
    super(props);

    this.durationOpts = [1, 3, 5, 7, 14];

    this.state = {
      listingMode: 'fixed',
      price: '',
      startPrice: '',
      endPrice: '',
      selectedName: '',
      nameQuery: '',
      nameFilter: 'all',
      durationIdx: 0,
      errorMessage: '',
    };
  }

  componentDidMount() {
    this.props.getMyNames();
    this.ensureSelectedNameInFiltered();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.isPlacingListing && !this.props.isPlacingListing && !this.props.isPlacingListingError) {
      this.props.onClose();
    }

    if (
      this.getNamesKey(prevProps.names) !== this.getNamesKey(this.props.names)
      || this.getNamesKey(prevProps.unavailableNames) !== this.getNamesKey(this.props.unavailableNames)
    ) {
      this.ensureSelectedNameInFiltered();
    }
  }

  getSortedNames(names) {
    return [...names].sort((a, b) => a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: 'base',
    }));
  }

  getNamesKey(names) {
    return this.getSortedNames(names).join('\n');
  }

  getFilteredNames(names) {
    return this.getFilteredNamesForState(names, this.state);
  }

  getFilteredNamesForState(names, state) {
    const query = state.nameQuery.trim().toLowerCase();
    let sortedNames = this.getSortedNames(this.getAvailableNames(names));

    if (state.nameFilter === 'expiring-soon') {
      sortedNames = sortedNames.filter((name) => {
        const blocksUntilExpire = this.getBlocksUntilExpire(name);
        return Number.isFinite(blocksUntilExpire) && blocksUntilExpire <= EXPIRING_SOON_BLOCKS;
      });
    }

    if (state.nameFilter === 'expiration-asc') {
      sortedNames = sortedNames.sort((a, b) => {
        const expirationCompare = this.getExpirationHeight(a) - this.getExpirationHeight(b);
        return expirationCompare || a.localeCompare(b, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      });
    }

    if (!query) {
      return sortedNames;
    }

    return sortedNames.filter((name) => name.toLowerCase().includes(query));
  }

  getAvailableNames(names) {
    const unavailableNames = new Set(this.props.unavailableNames);
    return names.filter(name => !unavailableNames.has(name));
  }

  getExpirationHeight(name) {
    const domain = this.props.nameDetails[name];
    const network = networks[this.props.network];

    if (!domain?.renewal || !network?.names?.renewalWindow) {
      return Number.MAX_SAFE_INTEGER;
    }

    return domain.renewal + network.names.renewalWindow;
  }

  getBlocksUntilExpire(name) {
    const expirationHeight = this.getExpirationHeight(name);
    if (expirationHeight === Number.MAX_SAFE_INTEGER || !this.props.height) {
      return Number.MAX_SAFE_INTEGER;
    }

    return expirationHeight - this.props.height;
  }

  getNameFilterItems() {
    const {t} = this.context;
    return [
      {label: t('allNames'), value: 'all'},
      {label: t('expiringSoon'), value: 'expiring-soon'},
      {label: t('expirationSoonest'), value: 'expiration-asc'},
    ];
  }

  getEffectiveSelectedName(names) {
    const filteredNames = this.getFilteredNames(names);
    return filteredNames.includes(this.state.selectedName)
      ? this.state.selectedName
      : filteredNames[0] || '';
  }

  ensureSelectedNameInFiltered = () => {
    const filteredNames = this.getFilteredNames(this.props.names);
    if (filteredNames.includes(this.state.selectedName)) {
      return;
    }

    this.setState({
      selectedName: filteredNames[0] || '',
    });
  };

  updateNameFilter = (nameFilter) => {
    this.setState((state) => {
      const nextState = {
        ...state,
        nameFilter,
        errorMessage: '',
      };
      const filteredNames = this.getFilteredNamesForState(this.props.names, nextState);
      return {
        nameFilter,
        selectedName: filteredNames[0] || '',
        errorMessage: '',
      };
    });
  };

  updateNameQuery = (nameQuery) => {
    this.setState((state) => {
      const nextState = {
        ...state,
        nameQuery,
        errorMessage: '',
      };
      const filteredNames = this.getFilteredNamesForState(this.props.names, nextState);
      return {
        nameQuery,
        selectedName: filteredNames[0] || '',
        errorMessage: '',
      };
    });
  };

  createListing = async () => {
    try {
      const selectedName = this.state.selectedName;
      const filteredNames = this.getFilteredNames(this.props.names);
      if (!selectedName) {
        throw new Error(this.context.t('noNamesFound'));
      }
      if (!filteredNames.includes(selectedName)) {
        throw new Error(this.context.t('selectedNameUnavailable'));
      }
      const params = this.state.listingMode === 'fixed'
        ? {
          mode: 'fixed',
          price: Math.round(Number(this.state.price) * 1e6),
        }
        : {
          mode: 'reverse',
          startPrice: Math.round(Number(this.state.startPrice) * 1e6),
          endPrice: Math.round(Number(this.state.endPrice) * 1e6),
          durationDays: this.durationOpts[this.state.durationIdx],
        };

      await this.props.transferExchangeLock(
        selectedName,
        params,
      );
    } catch (e) {
      this.setState({
        errorMessage: e.message,
      });
    }
  };

  render() {
    const {onClose, names} = this.props;
    const {t} = this.context;
    const filteredNames = this.getFilteredNames(names);
    const selectedName = filteredNames.includes(this.state.selectedName)
      ? this.state.selectedName
      : '';
    const selectedNameIndex = Math.max(filteredNames.indexOf(selectedName), 0);

    const isFixed = this.state.listingMode === 'fixed';
    const isValid = isFixed
      ? selectedName && this.state.price.length && Number(this.state.price) > 0
      : this.state.startPrice.length &&
        selectedName &&
        this.state.endPrice.length &&
        Number(this.state.startPrice) > 0 &&
        Number(this.state.endPrice) > 0 &&
        Number(this.state.startPrice) > Number(this.state.endPrice);

    return (
      <MiniModal
        title={t('createLearnHnsListing')}
        onClose={onClose}
        className="exchange__create-listing-modal"
      >
        <div className="exchange__place-listing-modal">
          <Alert type="warning">
            {t('learnHnsSellerLockWarning')}
          </Alert>
          <p>{t('learnHnsSellerFlowNote')}</p>
          <p><Anchor href={`${MARKET_API_BASE_URL}/docs`}>{t('learnMore')}</Anchor></p>
          <div className="exchange__label">{`${t('chooseName')}:`}</div>
          <Dropdown
            className="exchange__name-filter-mode"
            items={this.getNameFilterItems()}
            onChange={this.updateNameFilter}
            currentIndex={Math.max(
              this.getNameFilterItems().findIndex(({value}) => value === this.state.nameFilter),
              0,
            )}
          />
          <div className="exchange__name-filter">
            <input
              type="text"
              value={this.state.nameQuery}
              placeholder={t('filterNamesToList')}
              onChange={(e) => this.updateNameQuery(e.target.value)}
            />
          </div>
          <div className="exchange__input">
            <Dropdown
              items={filteredNames.length
                ? filteredNames.map(n => ({
                  label: formatName(n),
                  value: n,
                }))
                : [{label: t('noNamesFound'), disabled: true}]}
              onChange={(selectedName) => this.setState({
                selectedName,
                errorMessage: '',
              })}
              currentIndex={selectedNameIndex}
            />
          </div>

          <label className="exchange__label">{`${t('listingType')}:`}</label>
          <Dropdown
            items={[
              { label: t('buyNow') },
              { label: t('reverseAuction') },
            ]}
            onChange={(i) => this.setState({
              listingMode: i === 0 ? 'fixed' : 'reverse',
              errorMessage: '',
            })}
            currentIndex={isFixed ? 0 : 1}
          />

          {isFixed ? (
            <>
              <label className="exchange__label">{`${t('buyNowPrice')}:`}</label>
              <div className="exchange__input send__input">
                <input
                  type="number"
                  value={this.state.price}
                  onChange={(e) => this.setState({
                    price: e.target.value,
                    errorMessage: '',
                  })}
                />
              </div>
            </>
          ) : (
            <>
              <label className="exchange__label">{`${t('startingPrice')}:`}</label>
              <div className="exchange__input send__input">
                <input
                  type="number"
                  value={this.state.startPrice}
                  onChange={(e) => this.setState({
                    startPrice: e.target.value,
                    errorMessage: '',
                  })}
                />
              </div>

              <label className="exchange__label">{`${t('endingPrice')}:`}</label>
              <div className="exchange__input send__input">
                <input
                  type="number"
                  value={this.state.endPrice}
                  onChange={(e) => this.setState({
                    endPrice: e.target.value,
                    errorMessage: '',
                  })}
                />
              </div>

              <label className="exchange__label">{`${t('duration')}:`}</label>
              <Dropdown
                items={this.durationOpts.map(d => ({
                  label: `${d} ${t('days')}`,
                }))}
                onChange={(i) => this.setState({
                  durationIdx: i,
                  errorMessage: '',
                })}
                currentIndex={this.state.durationIdx}
              />
            </>
          )}
          {selectedName && (
            <div className="exchange__selected-name">
              {[
                `${t('selectedNameToList')}: ${formatName(selectedName)}`,
                this.getExpirationHeight(selectedName) !== Number.MAX_SAFE_INTEGER
                  ? `${t('expiresInBlocks')}: ${this.getBlocksUntilExpire(selectedName)}`
                  : null,
              ].filter(Boolean).join(' · ')}
            </div>
          )}
          <Alert type="error" message={this.state.errorMessage} />
          <div className="place-bid-modal__buttons">
            <button
              className="place-bid-modal__cancel"
              onClick={onClose}
              disabled={this.props.isPlacingListing}
            >
              {t('cancel')}
            </button>

            <button
              className="place-bid-modal__send"
              onClick={this.createListing}
              disabled={this.props.isPlacingListing || !isValid}
            >
              {this.props.isPlacingListing ? t('loading') : t('startListingLock')}
            </button>
          </div>
        </div>
      </MiniModal>
    );
  }
}

export default connect(
  (state) => ({
    isFetchingNames: state.myDomains.isFetching,
    names: Object.keys(state.myDomains.names),
    nameDetails: state.myDomains.names,
    unavailableNames: getUnavailableListingNames(state.exchange),
    height: state.node.chain.height,
    network: state.wallet.network,
    isPlacingListing: state.exchange.isPlacingListing,
    isPlacingListingError: state.exchange.isPlacingListingError,
  }),
  (dispatch) => ({
    getMyNames: () => dispatch(getMyNames()),
    transferExchangeLock: (name, params) => dispatch(transferExchangeLock(
      name,
      params,
    )),
  }),
)(PlaceListingModal);

function getUnavailableListingNames(exchange = {}) {
  const relistableStatuses = new Set([
    LISTING_STATUS.SOLD,
    LISTING_STATUS.FINALIZE_CANCEL_CONFIRMED,
  ]);
  const names = new Set();

  (exchange.listings || []).forEach((listing) => {
    const name = listing?.nameLock?.name;
    if (name && !relistableStatuses.has(listing.status)) {
      names.add(name);
    }
  });

  Object.values(exchange.auctions || {}).forEach((auction) => {
    if (auction?.name) {
      names.add(auction.name);
    }
  });

  return [...names];
}

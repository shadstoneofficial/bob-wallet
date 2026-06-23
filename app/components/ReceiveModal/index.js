import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import c from 'classnames';
import { withRouter } from 'react-router-dom';
import {QRCodeSVG} from 'qrcode.react';
import './receive.scss';
import CopyButton from '../CopyButton';
import { clientStub as aClientStub } from '../../background/analytics/client';
import {I18nContext} from "../../utils/i18n";
import walletClient from '../../utils/walletClient';
import {fetchWallet} from '../../ducks/walletActions';
import {displayBalance} from '../../utils/balances';

const analytics = aClientStub(() => require('electron').ipcRenderer);

const RECEIVE_TABS = {
  CURRENT: 'current',
  ADDRESSES: 'addresses',
};

@withRouter
@connect(
  state => ({
    address: state.wallet.receiveAddress,
  }),
  dispatch => ({
    fetchWallet: () => dispatch(fetchWallet()),
  }),
)
export default class ReceiveModal extends Component {
  static propTypes = {
    address: PropTypes.string.isRequired,
    fetchWallet: PropTypes.func.isRequired,
    history: PropTypes.shape({
      push: PropTypes.func.isRequired,
    }).isRequired,
    location: PropTypes.shape({
      pathname: PropTypes.string.isRequired,
    }).isRequired,
  };

  static contextType = I18nContext;

  state = {
    addresses: [],
    addressLabels: {},
    addressFilter: '',
    addressSort: {
      key: '',
      direction: 'asc',
    },
    lookupAddress: '',
    lookupPassphrase: '',
    lookupResult: null,
    lookupError: '',
    hasLoadedAddresses: false,
    isLoadingAddresses: false,
    isGeneratingAddress: false,
    isSavingAddressMetadata: false,
    isLookingUpAddress: false,
    isFindingShakeAccount: false,
    isShowingAddress: false,
    addressLoadError: '',
  };

  async componentDidMount() {
    analytics.screenView('Receive');

    if (this.getActiveTab() === RECEIVE_TABS.ADDRESSES) {
      await this.loadAddresses();
    }
  }

  async componentDidUpdate(prevProps) {
    if (
      this.props.location.pathname !== prevProps.location.pathname
      && this.getActiveTab() === RECEIVE_TABS.ADDRESSES
    ) {
      await this.loadAddresses();
    }
  }

  getActiveTab() {
    return this.props.location.pathname === '/receive/addresses'
      ? RECEIVE_TABS.ADDRESSES
      : RECEIVE_TABS.CURRENT;
  }

  setActiveTab = async (activeTab) => {
    const path = activeTab === RECEIVE_TABS.ADDRESSES
      ? '/receive/addresses'
      : '/receive';

    this.props.history.push(path);

    if (activeTab === RECEIVE_TABS.ADDRESSES) {
      await this.loadAddresses();
    }
  };

  loadAddresses = async () => {
    if (this.state.isLoadingAddresses) return;

    this.setState({
      isLoadingAddresses: true,
      addressLoadError: '',
    });

    try {
      const addresses = await walletClient.getReceiveAddresses();
      const addressLabels = addresses.reduce((labels, address) => ({
        ...labels,
        [this.getAddressKey(address)]: address.label || '',
      }), {});
      this.setState({
        addresses,
        addressLabels,
        hasLoadedAddresses: true,
      });
    } catch (e) {
      this.setState({
        addressLoadError: e.message || 'Could not load receive addresses.',
      });
    } finally {
      this.setState({isLoadingAddresses: false});
    }
  };

  getAddressKey(address) {
    return `${address.account || 'default'}:${address.branch || 0}:${address.index}`;
  }

  updateAddressLabel = (address, label) => {
    this.setState({
      addressLabels: {
        ...this.state.addressLabels,
        [this.getAddressKey(address)]: label,
      },
    });
  };

  saveAddressMetadata = async (address, updates = {}) => {
    if (this.state.isSavingAddressMetadata) return;

    const label = updates.label !== undefined
      ? updates.label
      : this.state.addressLabels[this.getAddressKey(address)] || '';
    const pinned = updates.pinned !== undefined ? updates.pinned : !!address.pinned;

    this.setState({isSavingAddressMetadata: true});

    try {
      await walletClient.setAddressMetadata({
        account: address.account || 'default',
        branch: address.branch || 0,
        index: address.index,
        label,
        pinned,
      });
      await this.loadAddresses();
    } finally {
      this.setState({isSavingAddressMetadata: false});
    }
  };

  lookupWalletAddress = async () => {
    const lookupAddress = this.state.lookupAddress.trim();
    if (!lookupAddress || this.state.isLookingUpAddress) return;

    this.setState({
      isLookingUpAddress: true,
      lookupError: '',
      lookupResult: null,
    });

    try {
      const lookupResult = await walletClient.lookupWalletAddress(lookupAddress);
      this.setState({lookupResult});
    } catch (e) {
      this.setState({
        lookupError: e.message || 'Could not check this address.',
      });
    } finally {
      this.setState({isLookingUpAddress: false});
    }
  };

  findShakeAccount = async () => {
    const lookupAddress = this.state.lookupAddress.trim();
    const lookupPassphrase = this.state.lookupPassphrase;
    if (!lookupAddress || !lookupPassphrase || this.state.isFindingShakeAccount) return;

    this.setState({
      isFindingShakeAccount: true,
      lookupError: '',
      lookupResult: null,
    });

    try {
      const lookupResult = await walletClient.findShakeWalletAddress(
        lookupAddress,
        lookupPassphrase,
      );
      this.setState({
        lookupResult,
        lookupPassphrase: '',
      });

      if (lookupResult.rescanStarted) {
        await this.loadAddresses();
      }
    } catch (e) {
      this.setState({
        lookupError: e.message || 'Could not scan additional Shake accounts.',
      });
    } finally {
      this.setState({isFindingShakeAccount: false});
    }
  };

  generateFreshAddress = async () => {
    if (this.state.isGeneratingAddress) return;

    this.setState({isGeneratingAddress: true});

    try {
      await walletClient.generateReceivingAddress();
      await this.props.fetchWallet();

      if (this.getActiveTab() === RECEIVE_TABS.ADDRESSES) {
        await this.loadAddresses();
      }
    } finally {
      this.setState({
        isGeneratingAddress: false,
        isShowingAddress: true,
      });
    }
  };

  renderCurrentAddress() {
    const {isShowingAddress, isGeneratingAddress} = this.state;
    const {t} = this.context;
    const {address} = this.props;

    return isShowingAddress ? (
      <div className="receive__content">
        <div className="receive__header">
          <div className="receive__title">{t('receiveModalYourAddressLabel')}</div>
        </div>
        <div className="receive__address-display">
          <div className="receive__address">{address}</div>
          <CopyButton content={address} />
        </div>
        <div className="receive__explanation">
          {t('receiveModalAddressExplainer')}{' '}
          <button
            className="receive__text-btn"
            onClick={() => this.setActiveTab(RECEIVE_TABS.ADDRESSES)}
          >
            {t('receiveModalAddressExplainerLink')}
          </button>
        </div>
        <div className="receive__qr-code">
          <QRCodeSVG value={address} />
        </div>
        <div className="receive__disclaimer">
          {t('receiveModalQRDisclaimer')}
        </div>
        <button
          className="receive__secondary-btn"
          disabled={isGeneratingAddress}
          onClick={this.generateFreshAddress}
        >
          {isGeneratingAddress
            ? t('receiveModalGeneratingAddress')
            : t('receiveModalGenerateAddress')}
        </button>
      </div>
    ) : (
      <div className="receive__content">
        <div className="receive__warning-icon" />
        <div className="receive__warning-title">
          {t('receiveModalWarning')}
        </div>
        <div className="receive__warning-subtitle">
          {t('receiveModalWarning2')}
        </div>
        <button
          className="receive__show-address-btn"
          onClick={() => this.setState({isShowingAddress: true})}
        >
          {t('receiveModalShowAddress')}
        </button>
      </div>
    );
  }

  renderAddressStatus(address) {
    const {t} = this.context;

    if (address.current) return t('receiveModalAddressStatusCurrent');
    if (address.used) return t('receiveModalAddressStatusUsed');
    return t('receiveModalAddressStatusUnused');
  }

  renderLastUsed(address) {
    if (!address.lastUsed) return '-';

    return new Date(address.lastUsed).toLocaleDateString();
  }

  getAddressStatusRank(address) {
    if (address.current) return 0;
    if (address.used) return 1;
    return 2;
  }

  getComparableAddressValue(address, key) {
    const label = this.state.addressLabels[this.getAddressKey(address)] || address.label || '';

    switch (key) {
      case 'status':
        return this.getAddressStatusRank(address);
      case 'label':
        return label.toLowerCase();
      case 'address':
        return address.address.toLowerCase();
      case 'balance':
        return Number(address.balance) || 0;
      case 'txCount':
        return Number(address.txCount) || 0;
      case 'lastUsed':
        return address.lastUsed ? new Date(address.lastUsed).getTime() : 0;
      default:
        return '';
    }
  }

  getFilteredAddresses() {
    const {addresses, addressFilter, addressSort} = this.state;
    const filter = addressFilter.trim().toLowerCase();
    const filteredAddresses = filter
      ? addresses.filter((address) => {
        const label = this.state.addressLabels[this.getAddressKey(address)] || address.label || '';
        return address.address.toLowerCase().includes(filter)
          || label.toLowerCase().includes(filter);
      })
      : addresses;

    if (!addressSort.key) {
      return filteredAddresses;
    }

    return [...filteredAddresses].sort((a, b) => {
      const aValue = this.getComparableAddressValue(a, addressSort.key);
      const bValue = this.getComparableAddressValue(b, addressSort.key);

      let comparison = 0;
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      return addressSort.direction === 'asc' ? comparison : comparison * -1;
    });
  }

  setAddressSort = (key) => {
    const {addressSort} = this.state;

    this.setState({
      addressSort: {
        key,
        direction: addressSort.key === key && addressSort.direction === 'asc'
          ? 'desc'
          : 'asc',
      },
    });
  };

  renderAddressHeader(key, label) {
    const {addressSort} = this.state;
    const isActive = addressSort.key === key;

    return (
      <button
        className={c('receive__addresses-sort', {
          'receive__addresses-sort--active': isActive,
        })}
        onClick={() => this.setAddressSort(key)}
      >
        <span>{label}</span>
        <span className="receive__addresses-sort-indicator">
          {isActive ? (addressSort.direction === 'asc' ? '^' : 'v') : ''}
        </span>
      </button>
    );
  }

  renderLookupResult() {
    const {lookupError, lookupResult} = this.state;

    if (lookupError) {
      return (
        <div className="receive__address-lookup-result receive__address-lookup-result--error">
          {lookupError}
        </div>
      );
    }

    if (!lookupResult) return null;

    const ownerships = lookupResult.ownerships || [];
    const seenItems = lookupResult.seen || [];
    const activeOwnership = ownerships.find(item => item.selected);
    const otherOwnership = ownerships.find(item => !item.selected);
    const activeDerived = (lookupResult.derivedMatches || []).find(item => item.selected);
    const otherDerived = (lookupResult.derivedMatches || []).find(item => !item.selected);
    const importedMatch = lookupResult.match;
    const seen = seenItems[0];
    let title = 'Not found in local Bob wallets';
    let detail = `Bob checked known wallet paths and derived receive/change addresses up to #${lookupResult.derivationLimit || 1000}, but did not find this address.`;

    if (lookupResult.status === 'imported-account' && importedMatch) {
      title = 'Shake account imported';
      detail = `${importedMatch.accountName} ${importedMatch.branchName} address #${importedMatch.index}. Bob found this address in HD account #${importedMatch.accountIndex}, created the missing account, and started a rescan for its history.`;
    } else if (lookupResult.status === 'found-existing-account' && importedMatch) {
      title = 'Found in existing Bob account';
      detail = `${importedMatch.accountName} ${importedMatch.branchName} address #${importedMatch.index}. Bob already has this HD account.`;
    } else if (activeOwnership) {
      title = 'Owned by selected wallet';
      detail = `${activeOwnership.accountName} ${activeOwnership.branchName} address #${activeOwnership.index}`;
    } else if (otherOwnership) {
      title = 'Owned by another local Bob wallet';
      detail = `${otherOwnership.walletId}: ${otherOwnership.accountName} ${otherOwnership.branchName} address #${otherOwnership.index}`;
    } else if (activeDerived) {
      title = 'Belongs to selected wallet';
      detail = activeDerived.inKnownDepth
        ? `${activeDerived.accountName} ${activeDerived.branchName} address #${activeDerived.index}. Bob can derive this address from this wallet, but it was not indexed in the local wallet path list.`
        : `${activeDerived.accountName} ${activeDerived.branchName} address #${activeDerived.index}. Bob can derive this address from this wallet, but it is beyond Bob's current ${activeDerived.branchName} depth of ${activeDerived.knownDepth}.`;
    } else if (otherDerived) {
      title = 'Belongs to another local Bob wallet';
      detail = `${otherDerived.walletId}: ${otherDerived.accountName} ${otherDerived.branchName} address #${otherDerived.index}. Bob derived this address from that wallet.`;
    } else if (seen) {
      title = 'Seen in Bob history, not owned by this wallet';
      detail = `${seen.walletId} saw this address in a ${seen.action || seen.type} transaction: ${seen.txHash}`;
    }

    return (
      <div className={c('receive__address-lookup-result', {
        'receive__address-lookup-result--found': lookupResult.status !== 'not-found',
      })}
      >
        <div className="receive__address-lookup-title">{title}</div>
        <div className="receive__address-lookup-detail">{detail}</div>
      </div>
    );
  }

  renderAddresses() {
    const {t} = this.context;
    const {
      addressLabels,
      addressFilter,
      lookupAddress,
      addressLoadError,
      isGeneratingAddress,
      isLoadingAddresses,
      hasLoadedAddresses,
      isSavingAddressMetadata,
      isLookingUpAddress,
      isFindingShakeAccount,
    } = this.state;

    if (isLoadingAddresses && !hasLoadedAddresses) {
      return (
        <div className="receive__addresses-state">
          {t('receiveModalAddressesLoading')}
        </div>
      );
    }

    if (addressLoadError) {
      return (
        <div className="receive__addresses-state receive__addresses-state--error">
          {addressLoadError}
        </div>
      );
    }

    const visibleAddresses = this.getFilteredAddresses();

    return (
      <div className="receive__addresses">
        <div className="receive__addresses-heading">
          <div>
            <div className="receive__title">{t('receiveModalAddressesTitle')}</div>
            <div className="receive__addresses-help">
              {t('receiveModalAddressesHelp')}
            </div>
          </div>
          <button
            className="receive__secondary-btn receive__secondary-btn--compact"
            disabled={isGeneratingAddress}
            onClick={this.generateFreshAddress}
          >
            {isGeneratingAddress
              ? t('receiveModalGeneratingAddress')
              : t('receiveModalGenerateAddress')}
          </button>
        </div>
        <div className="receive__addresses-toolbar">
          <input
            className="receive__addresses-filter"
            value={addressFilter}
            placeholder="Filter by address or label"
            onChange={(e) => this.setState({addressFilter: e.target.value})}
          />
        </div>
        <div className="receive__address-lookup">
          <div className="receive__address-lookup-title">Check Shake/Bob address</div>
          <div className="receive__address-lookup-form">
            <input
              className="receive__addresses-filter receive__address-lookup-input"
              value={lookupAddress}
              placeholder="Paste a Handshake address"
              onChange={(e) => this.setState({
                lookupAddress: e.target.value,
                lookupError: '',
                lookupResult: null,
              })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  this.lookupWalletAddress();
                }
              }}
            />
            <button
              className="receive__metadata-btn receive__address-lookup-btn"
              disabled={!lookupAddress.trim() || isLookingUpAddress}
              onClick={this.lookupWalletAddress}
            >
              {isLookingUpAddress ? 'Checking...' : 'Check'}
            </button>
          </div>
          <div className="receive__address-lookup-recovery">
            <input
              className="receive__addresses-filter receive__address-lookup-password"
              type="password"
              value={this.state.lookupPassphrase}
              placeholder="Bob password to scan Shake accounts"
              onChange={(e) => this.setState({
                lookupPassphrase: e.target.value,
                lookupError: '',
              })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  this.findShakeAccount();
                }
              }}
            />
            <button
              className="receive__metadata-btn receive__address-lookup-btn"
              disabled={!lookupAddress.trim() || !this.state.lookupPassphrase || isFindingShakeAccount}
              onClick={this.findShakeAccount}
            >
              {isFindingShakeAccount ? 'Scanning...' : 'Find Shake account'}
            </button>
          </div>
          {this.renderLookupResult()}
        </div>
        <div className="receive__addresses-table">
          <div className="receive__addresses-row receive__addresses-row--header">
            <div>{this.renderAddressHeader('status', t('receiveModalAddressStatus'))}</div>
            <div>{this.renderAddressHeader('label', 'Label')}</div>
            <div>{this.renderAddressHeader('address', t('address'))}</div>
            <div>{this.renderAddressHeader('balance', t('receiveModalAddressBalance'))}</div>
            <div>{this.renderAddressHeader('txCount', t('receiveModalAddressTxs'))}</div>
            <div>{this.renderAddressHeader('lastUsed', t('receiveModalAddressLastUsed'))}</div>
            <div>{t('receiveModalAddressActions')}</div>
          </div>
          {visibleAddresses.length === 0 && (
            <div className="receive__addresses-state receive__addresses-state--empty">
              No addresses match this filter.
            </div>
          )}
          {visibleAddresses.map(address => {
            const addressKey = this.getAddressKey(address);
            const label = addressLabels[addressKey] || '';

            return (
              <div className="receive__addresses-row" key={address.address}>
                <div>
                  <span className={c('receive__address-status', {
                    'receive__address-status--current': address.current,
                    'receive__address-status--used': address.used && !address.current,
                  })}
                  >
                    {this.renderAddressStatus(address)}
                  </span>
                </div>
                <div className="receive__addresses-label-cell">
                  <input
                    className="receive__addresses-label"
                    value={label}
                    placeholder="Add label"
                    disabled={isSavingAddressMetadata}
                    onChange={(e) => this.updateAddressLabel(address, e.target.value)}
                    onBlur={() => this.saveAddressMetadata(address, {label})}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="receive__addresses-address" title={address.address}>
                  {address.address}
                </div>
                <div>{displayBalance(address.balance)} HNS</div>
                <div>{address.txCount}</div>
                <div>{this.renderLastUsed(address)}</div>
                <div className="receive__addresses-actions">
                  <button
                    className={c('receive__metadata-btn', {
                      'receive__metadata-btn--active': address.pinned,
                    })}
                    disabled={isSavingAddressMetadata}
                    onClick={() => this.saveAddressMetadata(address, {
                      label,
                      pinned: !address.pinned,
                    })}
                  >
                    {address.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <CopyButton content={address.address} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  renderContent() {
    if (this.getActiveTab() === RECEIVE_TABS.ADDRESSES) {
      return this.renderAddresses();
    }

    return this.renderCurrentAddress();
  }

  render() {
    return (
      <div className={c('receive__container', {
        'receive__container--wide': this.getActiveTab() === RECEIVE_TABS.ADDRESSES,
      })}
      >
        {this.renderContent()}
      </div>
    );
  }
}

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
    hasLoadedAddresses: false,
    isLoadingAddresses: false,
    isGeneratingAddress: false,
    isSavingAddressMetadata: false,
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

  renderAddresses() {
    const {t} = this.context;
    const {
      addresses,
      addressLabels,
      addressLoadError,
      isGeneratingAddress,
      isLoadingAddresses,
      hasLoadedAddresses,
      isSavingAddressMetadata,
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
        <div className="receive__addresses-table">
          <div className="receive__addresses-row receive__addresses-row--header">
            <div>{t('receiveModalAddressStatus')}</div>
            <div>Label</div>
            <div>{t('address')}</div>
            <div>{t('receiveModalAddressBalance')}</div>
            <div>{t('receiveModalAddressTxs')}</div>
            <div>{t('receiveModalAddressLastUsed')}</div>
            <div>{t('receiveModalAddressActions')}</div>
          </div>
          {addresses.map(address => {
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
                <div>
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

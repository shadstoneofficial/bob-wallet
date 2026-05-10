import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Route, Switch, withRouter } from 'react-router-dom';
import { ContentArea } from '../ContentArea';
import { connect } from 'react-redux';
import './index.scss';
import AccountIndexModal from './AccountIndexModal';
import MaxIdleModal from './MaxIdleModal';
import AccountKeyModal from './AccountKeyModal';
import RevealSeedModal from './RevealSeedModal';
import ZapTXsModal from './ZapTXsModal';
import * as logger from '../../utils/logClient';
import * as walletActions from '../../ducks/walletActions';
import * as nodeActions from '../../ducks/node';
import NetworkPicker from '../NetworkPicker';
import Hip2Picker from '../Hip2Picker';
import ExplorerPicker from '../ExplorerPicker';
import { clientStub as aClientStub } from '../../background/analytics/client';
const pkg = require('../../../package.json');
import c from "classnames";
import {Redirect} from "react-router";
import {setCustomRPCStatus} from "../../ducks/node";
import CustomRPCConfigModal from "./CustomRPCConfigModal";
import {fetchWalletAPIKey} from "../../ducks/walletActions";
import Anchor from "../../components/Anchor";
import walletClient from "../../utils/walletClient";
import InterstitialWarningModal from "./InterstitialWarningModal";
import DeepCleanAndRescanModal from "./DeepCleanAndRescanModal";
import {showError, showSuccess} from "../../ducks/notifications";
import BackupListingModal from "./BackupListingModal";
import fs from "fs";
const {dialog} = require('@electron/remote');
import {clientStub as sClientStub} from "../../background/shakedex/client";
import ChangeDirectoryModal from "./ChangeDirectoryModal";
import dbClient from "../../utils/dbClient";
import {clientStub} from "../../background/node/client";
import APIKeyModal from "./APIKeyModal";
import {clientStub as cClientStub} from "../../background/connections/client";
import {ConnectionTypes} from "../../background/connections/service";
import Dropdown from "../../components/Dropdown";
import {I18nContext, langs, languageDropdownItems} from "../../utils/i18n";
import {setLocale, setCustomLocale} from "../../ducks/app";
import {clientStub as settingClientStub} from "../../background/setting/client";
import {DEFAULT_SHAKEDEX_CHANNEL_HOST} from "../../constants/shakedexChannels";
import {
  DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
  LIQUIDITY_SPOT_CHANNEL_LIST_STORAGE_KEY,
  LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY,
  getLiquiditySpotChannelUrl,
  mergeLiquiditySpotChannels,
  normalizeLiquiditySpotHost,
} from "../../constants/liquiditySpotChannels";

const analytics = aClientStub(() => require('electron').ipcRenderer);
const shakedex = sClientStub(() => require('electron').ipcRenderer);
const nodeClient = clientStub(() => require('electron').ipcRenderer);
const connClient = cClientStub(() => require('electron').ipcRenderer);
const settingClient = settingClientStub(() => require('electron').ipcRenderer);

@withRouter
@connect(
  (state) => ({
    locale: state.app.locale,
    network: state.wallet.network,
    apiKey: state.node.apiKey,
    spv: state.node.spv,
    rsPort: state.node.rsPort,
    nsPort: state.node.nsPort,
    noDns: state.node.noDns,
    walletApiKey: state.wallet.apiKey,
    walletSync: state.wallet.walletSync,
    walletInitialized: state.wallet.initialized,
    wid: state.wallet.wid,
    changeDepth: state.wallet.changeDepth,
    receiveDepth: state.wallet.receiveDepth,
    isRunning: state.node.isRunning,
    isChangingNodeStatus: state.node.isChangingNodeStatus,
    isTestingCustomRPC: state.node.isTestingCustomRPC,
    isCustomRPCConnected: state.node.isCustomRPCConnected,
    transactions: state.wallet.transactions,
  }),
  dispatch => ({
    lockWallet: () => dispatch(walletActions.lockWallet()),
    reset: () => dispatch(walletActions.reset()),
    stopNode: () => dispatch(nodeActions.stop()),
    startNode: () => dispatch(nodeActions.start()),
    setNoDns: (noDns) => dispatch(nodeActions.setNoDns(noDns)),
    setCustomRPCStatus: isConnected => dispatch(setCustomRPCStatus(isConnected)),
    fetchWalletAPIKey: () => dispatch(fetchWalletAPIKey()),
    showError: (message) => dispatch(showError(message)),
    showSuccess: (message) => dispatch(showSuccess(message)),
    fetchWallet: () => dispatch(walletActions.fetchWallet()),
    setLocale: (locale) => dispatch(setLocale(locale)),
    setCustomLocale: (locale) => dispatch(setCustomLocale(locale)),
  }),
)
export default class Settings extends Component {
  static propTypes = {
    network: PropTypes.string.isRequired,
    apiKey: PropTypes.string,
    locale: PropTypes.string.isRequired,
    rsPort: PropTypes.number.isRequired,
    nsPort: PropTypes.number.isRequired,
    noDns: PropTypes.bool.isRequired,
    spv: PropTypes.bool.isRequired,
    wid: PropTypes.string.isRequired,
    changeDepth: PropTypes.number.isRequired,
    receiveDepth: PropTypes.number.isRequired,
    walletApiKey: PropTypes.string.isRequired,
    isRunning: PropTypes.bool.isRequired,
    walletSync: PropTypes.bool.isRequired,
    walletInitialized: PropTypes.bool.isRequired,
    isChangingNodeStatus: PropTypes.bool.isRequired,
    lockWallet: PropTypes.func.isRequired,
    reset: PropTypes.func.isRequired,
    stopNode: PropTypes.func.isRequired,
    startNode: PropTypes.func.isRequired,
    setNoDns: PropTypes.func.isRequired,
    showError: PropTypes.func.isRequired,
    showSuccess: PropTypes.func.isRequired,
    setLocale: PropTypes.func.isRequired,
    setCustomLocale: PropTypes.func.isRequired,
    setCustomRPCStatus: PropTypes.func.isRequired,
    transactions: PropTypes.object.isRequired,
    fetchWallet: PropTypes.func.isRequired,
  };

  static contextType = I18nContext;

  constructor(props) {
    super(props);
    this.state = {
      changeDepth: props.changeDepth,
      receiveDepth: props.receiveDepth,
      isUpdatingDepth: false,
      customRPCStatus: '',
      shakedexChannelHost: DEFAULT_SHAKEDEX_CHANNEL_HOST,
      shakedexChannelDraftHost: DEFAULT_SHAKEDEX_CHANNEL_HOST,
      shakedexChannelStatus: '',
      shakedexChannelError: '',
      isValidatingShakedexChannel: false,
      isSavingShakedexChannel: false,
      liquiditySpotHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotDraftHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotChannels: mergeLiquiditySpotChannels(),
      liquiditySpotStatus: '',
      liquiditySpotError: '',
      isValidatingLiquidityChannel: false,
    }
  }

  async componentDidMount() {
    analytics.screenView('Settings');
    this.props.fetchWalletAPIKey();
    const directory = await nodeClient.getDir();
    const userDir = await dbClient.getUserDir();
    this.setState({
      directory,
      userDir,
    });
    this.loadChannelSettings();
  }

  onDownload = async () => {
    try {
      const {network} = this.props;
      const savePath = dialog.showSaveDialogSync({
        defaultPath: `bob-debug-${network}.log`,
        filters: [{name: 'log file', extensions: ['log']}],
      });
      if (!savePath) return;
      await logger.download(network, savePath);
      this.props.showSuccess(this.context.t('logDownloadSuccess', savePath));
    } catch (e) {
      logger.error(e.message);
      this.props.showError(e.message);
    }
  };

  onBackupWDB = async () => {
    try {
      let savePath = dialog.showOpenDialogSync({
        properties: ["openDirectory", "promptToCreate", "createDirectory"],
      });

      await walletClient.backup(savePath[0]);
      this.props.showSuccess(this.context.t('wdbBackupSuccess'));
    } catch (e) {
      this.props.showError(e.message);
    }
  };

  onDownloadExchangeBackup = async () => {
    const listings = await shakedex.getListings();
    const fills = await shakedex.getFulfillments();
    const data = JSON.stringify({listings, fills});
    const savePath = dialog.showSaveDialogSync({
      filters: [{name: 'exchange-listing', extensions: ['json']}],
    });

    return new Promise((resolve, reject) => {
      if (savePath) {
        fs.writeFile(savePath, data, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(savePath);
          }
        });
      }
    });
  };

  onSetLocale = async (locale) => {
    if (locale === 'custom') {
      const {
        filePaths: [filepath]
      } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: {
          extensions: ['json'],
        },
      });

      try {
        const buf = await fs.promises.readFile(filepath);
        const customLocale = JSON.parse(buf);
        return this.props.setCustomLocale(customLocale);
      } catch (e) {
        return this.props.showError(e.message);
      }
    } else {
      return this.props.setLocale(locale);
    }
  };

  onRestoreExchangeListing = async () => {
    const {
      filePaths: [filepath]
    } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: {
        extensions: ['json'],
      },
    });

    try {
      const buf = await fs.promises.readFile(filepath);
      const {listings, fills} = JSON.parse(buf);

      for (let listing of listings) {
        await shakedex.restoreOneListing(listing)
      }

      for (let fill of fills) {
        await shakedex.restoreOneFill(fill)
      }

      await this.props.showSuccess(this.context.t('restoreAuctionsSuccess', listings.length + fills.length));
    } catch (e) {
      this.props.showError(e.message);
    }
  };

  loadChannelSettings = async () => {
    try {
      const shakedexSettings = await shakedex.getShakedexChannelSettings();
      const liquiditySpotHost = normalizeLiquiditySpotHost(
        window.localStorage.getItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY),
      ) || DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST;
      const liquiditySpotChannels = this.getStoredLiquiditySpotChannels();

      this.setState({
        shakedexChannelHost: shakedexSettings.host,
        shakedexChannelDraftHost: shakedexSettings.host,
        shakedexChannelStatus: '',
        shakedexChannelError: '',
        liquiditySpotHost,
        liquiditySpotDraftHost: liquiditySpotHost,
        liquiditySpotChannels,
      });
    } catch (e) {
      this.setState({
        shakedexChannelError: e.message,
      });
    }
  };

  getStoredLiquiditySpotChannels = () => {
    try {
      const channels = JSON.parse(window.localStorage.getItem(LIQUIDITY_SPOT_CHANNEL_LIST_STORAGE_KEY) || '[]');
      return mergeLiquiditySpotChannels(channels);
    } catch (e) {
      return mergeLiquiditySpotChannels();
    }
  };

  persistLiquiditySpotChannels = (channels) => {
    window.localStorage.setItem(LIQUIDITY_SPOT_CHANNEL_LIST_STORAGE_KEY, JSON.stringify(channels));
  };

  exportChannelSettings = async () => {
    try {
      const shakedexSettings = await shakedex.getShakedexChannelSettings();
      const liquiditySpotHost = normalizeLiquiditySpotHost(
        window.localStorage.getItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY),
      ) || DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST;
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        shakedex: {
          activeHost: shakedexSettings.host,
          defaultHost: shakedexSettings.defaultHost,
        },
        liquiditySpot: {
          activeHost: liquiditySpotHost,
          channels: this.getStoredLiquiditySpotChannels(),
        },
      };
      const savePath = dialog.showSaveDialogSync({
        defaultPath: 'bob-channel-settings.json',
        filters: [{name: 'Bob channel settings', extensions: ['json']}],
      });
      if (!savePath) return;
      await fs.promises.writeFile(savePath, JSON.stringify(payload, null, 2));
      this.props.showSuccess(`Exported channel settings to ${savePath}`);
    } catch (e) {
      this.props.showError(e.message);
    }
  };

  importChannelSettings = async () => {
    try {
      const {
        filePaths: [filepath],
      } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{name: 'Bob channel settings', extensions: ['json']}],
      });
      if (!filepath) return;

      const payload = JSON.parse(await fs.promises.readFile(filepath, 'utf-8'));
      const shakedexHost = payload?.shakedex?.activeHost;
      const liquiditySpotHost = normalizeLiquiditySpotHost(payload?.liquiditySpot?.activeHost);
      const liquiditySpotChannels = mergeLiquiditySpotChannels(payload?.liquiditySpot?.channels || []);

      if (shakedexHost) {
        await shakedex.setShakedexChannelHost(shakedexHost);
      }

      if (liquiditySpotHost) {
        window.localStorage.setItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY, liquiditySpotHost);
      }

      this.persistLiquiditySpotChannels(liquiditySpotChannels);
      await this.loadChannelSettings();
      this.props.showSuccess('Imported channel settings.');
    } catch (e) {
      this.props.showError(e.message);
    }
  };

  validateShakedexChannel = async () => {
    this.setState({
      isValidatingShakedexChannel: true,
      shakedexChannelStatus: '',
      shakedexChannelError: '',
    });

    try {
      const result = await shakedex.validateShakedexChannelHost(this.state.shakedexChannelDraftHost);
      const status = result.status || {};
      const progress = status.progress ? `${Math.min(100, Math.max(0, status.progress * 100)).toFixed(2)}%` : 'unknown sync';

      this.setState({
        shakedexChannelStatus: result.ok
          ? `Reachable. HSD ${status.reachable === false ? 'offline' : 'online'}, ${progress}.`
          : '',
        shakedexChannelError: result.ok ? '' : (result.error || 'Channel validation failed.'),
      });
    } catch (e) {
      this.setState({shakedexChannelError: e.message});
    } finally {
      this.setState({isValidatingShakedexChannel: false});
    }
  };

  saveShakedexChannel = async () => {
    this.setState({
      isSavingShakedexChannel: true,
      shakedexChannelStatus: '',
      shakedexChannelError: '',
    });

    try {
      const settings = await shakedex.setShakedexChannelHost(this.state.shakedexChannelDraftHost);
      this.setState({
        shakedexChannelHost: settings.host,
        shakedexChannelDraftHost: settings.host,
        shakedexChannelStatus: `Active channel set to ${settings.host}.`,
      });
    } catch (e) {
      this.setState({shakedexChannelError: e.message});
    } finally {
      this.setState({isSavingShakedexChannel: false});
    }
  };

  resetShakedexChannel = async () => {
    try {
      const settings = await shakedex.resetShakedexChannelHost();
      this.setState({
        shakedexChannelHost: settings.host,
        shakedexChannelDraftHost: settings.host,
        shakedexChannelStatus: 'Reset to the default Shakedex channel.',
        shakedexChannelError: '',
      });
    } catch (e) {
      this.setState({shakedexChannelError: e.message});
    }
  };

  saveLiquiditySpotChannel = () => {
    const host = normalizeLiquiditySpotHost(this.state.liquiditySpotDraftHost);
    if (!host) {
      this.setState({
        liquiditySpotStatus: '',
        liquiditySpotError: 'Enter a valid Liquidity channel host.',
      });
      return;
    }

    window.localStorage.setItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY, host);
    const liquiditySpotChannels = mergeLiquiditySpotChannels([
      ...this.state.liquiditySpotChannels,
      {host, label: host},
    ]);
    this.persistLiquiditySpotChannels(liquiditySpotChannels);
    this.setState({
      liquiditySpotHost: host,
      liquiditySpotDraftHost: host,
      liquiditySpotChannels,
      liquiditySpotStatus: `Active Liquidity channel set to ${host}.`,
      liquiditySpotError: '',
    });
  };

  validateLiquiditySpotChannel = async () => {
    this.setState({
      isValidatingLiquidityChannel: true,
      liquiditySpotStatus: '',
      liquiditySpotError: '',
    });

    try {
      const result = await settingClient.validateLiquidityChannelHost(this.state.liquiditySpotDraftHost);
      this.setState({
        liquiditySpotStatus: result.ok ? `Reachable at ${result.url}.` : '',
        liquiditySpotError: result.ok ? '' : (result.error || 'Liquidity channel validation failed.'),
      });
    } catch (e) {
      this.setState({liquiditySpotError: e.message});
    } finally {
      this.setState({isValidatingLiquidityChannel: false});
    }
  };

  resetLiquiditySpotChannel = () => {
    window.localStorage.removeItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY);
    this.setState({
      liquiditySpotHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotDraftHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotChannels: mergeLiquiditySpotChannels(),
      liquiditySpotStatus: 'Reset to the default Liquidity channel.',
      liquiditySpotError: '',
    });
  };

  renderNav() {
    const { history, location } = this.props;
    const {t} = this.context;

    return (
      <div className="settings__nav">
        <div
          className={c("settings__nav__item", {
            'settings__nav__item--selected': location.pathname === '/settings/general',
          })}
          onClick={() => history.push("/settings/general")}
        >
          {t('settingGeneral')}
        </div>
        <div
          className={c("settings__nav__item", {
            'settings__nav__item--selected': location.pathname === '/settings/wallet',
          })}
          onClick={() => history.push("/settings/wallet")}
        >
          {t('settingWallet')}
        </div>
        <div
          className={c("settings__nav__item", {
            'settings__nav__item--selected': location.pathname === '/settings/connection',
          })}
          onClick={() => history.push("/settings/connection")}
        >
          {t('settingNetAndConn')}
        </div>
        <div
          className={c("settings__nav__item", {
            'settings__nav__item--selected': location.pathname === '/settings/exchange',
          })}
          onClick={() => history.push("/settings/exchange")}
        >
          {t('settingExchange')}
        </div>
        <div
          className={c("settings__nav__item", {
            'settings__nav__item--selected': location.pathname === '/settings/addons',
          })}
          onClick={() => history.push("/settings/addons")}
        >
          Add Ons
        </div>
      </div>
    );
  }

  renderSection(
    title = '',
    description = '',
    cta = '',
    onClick,
    children,
    disabled = false,
    disableButtonOnly = false,
  ) {
    return (
      <div
        className={c("settings__content__section", {
          'settings__content__section--disabled': disabled && !disableButtonOnly,
        })}
      >
        <div className="settings__content__section__info">
          <div className="settings__content__section__info__title">
            {title}
          </div>
          <div className="settings__content__section__info__description">
            {description}
          </div>
        </div>
        <div className="settings__content__section__footer">
          {children}
          {cta && (
            <button
              className="settings__content__section__cta"
              onClick={onClick}
              disabled={disabled}
            >
              {cta}
            </button>
          )}
        </div>
      </div>
    )
  }

  renderWallet() {
    const {
      history,
      lockWallet,
      transactions,
      wid,
      walletInitialized,
      walletSync,
    } = this.props;

    const {t} = this.context;

    return (
      <>
        {this.renderSection(
          t('settingLockWalletTitle'),
          t('settingLockWalletDesc'),
          t('settingLockWalletCTA'),
          lockWallet,
        )}
        {this.renderSection(
          t('settingRescanTitle'),
          <div>
            <div>{t('settingRescanDesc', transactions.size)}</div>
          </div>,
          t('settingRescanCTA'),
          () => walletClient.rescan(0),
          null,
          !walletInitialized || walletSync, // disabled?
        )}
        {this.renderSection(
          t('settingBackupWDBTitle'),
          <div>
            <div>{t('settingBackupWDBDesc')}</div>
          </div>,
          t('settingBackupWDBTitle'),
          this.onBackupWDB,
        )}
        {this.renderSection(
          t('settingDeepcleanTitle'),
          <div>
            <div>{t('settingDeepcleanDesc')} - <Anchor href="https://github.com/handshake-org/hsd/blob/master/CHANGELOG.md#wallet-api-changes-1">{t('learnMore')}</Anchor></div>
          </div>,
          t('deepcleanTitle'),
          () => history.push('/settings/wallet/deep-clean-and-rescan'),
          null,
          !walletInitialized, // disabled?
        )}
        {this.renderSection(
          t('apiKey'),
          <span>
            {t('settingAPIKeyDesc', wid)} (<Anchor href="https://hsd-dev.org/api-docs/#get-wallet-info">hsw-cli</Anchor>, <Anchor href="https://hsd-dev.org/api-docs/#selectwallet">hsw-rpc</Anchor>)
          </span>,
          t('settingAPIKeyCTA'),
          () => history.push('/settings/wallet/view-api-key'),
        )}
        {this.renderSection(
          t('settingZapTitle'),
          t('settingZapDesc'),
          t('settingZapCTA'),
          () => history.push('/settings/wallet/zap-txs'),
        )}
        {this.renderSection(
          t('settingAccountKeyTitle'),
          t('settingAccountKeyDesc'),
          t('settingAccountKeyCTA'),
          () => history.push('/settings/wallet/account-key'),
        )}
        {this.renderSection(
          t('settingRevealSeedTitle'),
          t('settingRevealSeedDesc'),
          t('settingRevealSeedCTA'),
          () => history.push('/settings/wallet/reveal-seed'),
        )}
        {this.renderSection(
          t('settingCreateWalletTitle'),
          t('settingCreateWalletDesc'),
          t('settingCreateWalletCTA'),
          () => history.push('/funding-options'),
        )}
        {this.renderSection(
          t('settingRemoveWalletTitle'),
          t('settingRemoveWalletDesc', wid),
          t('settingRemoveWalletCTA'),
          () => history.push('/settings/wallet/remove-wallet'),
        )}
      </>
    );
  }

  renderExchange() {
    const { history } = this.props;
    const {t} = this.context;
    const {
      shakedexChannelHost,
      shakedexChannelDraftHost,
      shakedexChannelStatus,
      shakedexChannelError,
      isValidatingShakedexChannel,
      isSavingShakedexChannel,
    } = this.state;

    return (
      <>
        {this.renderSection(
          t('settingShakedexChannelTitle'),
          t('settingShakedexChannelDesc'),
          '',
          null,
          <div className="settings__channel-card">
            <div className="settings__channel-card__row">
              <span>{t('activeChannel')}</span>
              <strong>{shakedexChannelHost}</strong>
            </div>
            <div className="settings__channel-card__row">
              <span>{t('settingShakedexChannelApi')}</span>
              <strong>{`https://${shakedexChannelHost}/api/v2`}</strong>
            </div>
            <input
              className="settings__channel-card__input"
              value={shakedexChannelDraftHost}
              onChange={event => this.setState({
                shakedexChannelDraftHost: event.target.value,
                shakedexChannelStatus: '',
                shakedexChannelError: '',
              })}
              placeholder="market.learnhns.com"
            />
            <div className="settings__channel-card__actions">
              <button
                className="settings__content__section__cta"
                onClick={this.validateShakedexChannel}
                disabled={isValidatingShakedexChannel}
              >
                {isValidatingShakedexChannel ? 'Checking...' : 'Validate'}
              </button>
              <button
                className="settings__content__section__cta"
                onClick={this.saveShakedexChannel}
                disabled={isSavingShakedexChannel}
              >
                {isSavingShakedexChannel ? 'Saving...' : 'Save Channel'}
              </button>
              <button
                className="settings__content__section__cta"
                onClick={this.resetShakedexChannel}
              >
                Reset Default
              </button>
            </div>
            {shakedexChannelStatus && (
              <div className="settings__channel-card__status settings__channel-card__status--ok">
                {shakedexChannelStatus}
              </div>
            )}
            {shakedexChannelError && (
              <div className="settings__channel-card__status settings__channel-card__status--error">
                {shakedexChannelError}
              </div>
            )}
            <button
              className="settings__content__section__cta"
              onClick={() => history.push('/exchange')}
            >
              {t('headingShakedexMarketplace')}
            </button>
            <div className="settings__channel-card__actions">
              <button
                className="settings__content__section__cta"
                onClick={this.exportChannelSettings}
              >
                Export Channels
              </button>
              <button
                className="settings__content__section__cta"
                onClick={this.importChannelSettings}
              >
                Import Channels
              </button>
            </div>
          </div>,
        )}
        {this.renderSection(
          t('settingBackupListingTitle'),
          t('settingBackupListingDesc'),
          t('download'),
          () => history.push('/settings/exchange/backup'),
        )}
        {this.renderSection(
          t('settingRestoreListingTitle'),
          t('settingRestoreListingDesc'),
          t('settingRestoreListingCTA'),
          this.onRestoreExchangeListing,
        )}
      </>
    )
  }

  renderAddons() {
    const {
      liquiditySpotHost,
      liquiditySpotDraftHost,
      liquiditySpotChannels,
      liquiditySpotStatus,
      liquiditySpotError,
      isValidatingLiquidityChannel,
    } = this.state;

    return (
      <>
        {this.renderSection(
          'Liquidity Channel',
          'Choose which Liquidity channel opens from Bob Add Ons.',
          '',
          null,
          <div className="settings__channel-card">
            <div className="settings__channel-card__row">
              <span>{this.context.t('activeChannel')}</span>
              <strong>{liquiditySpotHost}</strong>
            </div>
            <div className="settings__channel-card__row">
              <span>App URL</span>
              <strong>{getLiquiditySpotChannelUrl(liquiditySpotHost)}</strong>
            </div>
            <select
              className="settings__channel-card__input"
              value={liquiditySpotHost}
              onChange={event => {
                const host = event.target.value;
                window.localStorage.setItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY, host);
                this.setState({
                  liquiditySpotHost: host,
                  liquiditySpotDraftHost: host,
                  liquiditySpotStatus: `Active Liquidity channel set to ${host}.`,
                  liquiditySpotError: '',
                });
              }}
            >
              {liquiditySpotChannels.map(channel => (
                <option key={channel.host} value={channel.host}>
                  {channel.label}
                </option>
              ))}
            </select>
            <input
              className="settings__channel-card__input"
              value={liquiditySpotDraftHost}
              onChange={event => this.setState({
                liquiditySpotDraftHost: event.target.value,
                liquiditySpotStatus: '',
                liquiditySpotError: '',
              })}
              placeholder="liquidity.spot"
            />
            <div className="settings__channel-card__actions">
              <button
                className="settings__content__section__cta"
                onClick={this.validateLiquiditySpotChannel}
                disabled={isValidatingLiquidityChannel}
              >
                {isValidatingLiquidityChannel ? 'Checking...' : 'Validate'}
              </button>
              <button
                className="settings__content__section__cta"
                onClick={this.saveLiquiditySpotChannel}
              >
                Save Channel
              </button>
              <button
                className="settings__content__section__cta"
                onClick={this.resetLiquiditySpotChannel}
              >
                Reset Default
              </button>
            </div>
            {liquiditySpotStatus && (
              <div className="settings__channel-card__status settings__channel-card__status--ok">
                {liquiditySpotStatus}
              </div>
            )}
            {liquiditySpotError && (
              <div className="settings__channel-card__status settings__channel-card__status--error">
                {liquiditySpotError}
              </div>
            )}
          </div>,
        )}
        {this.renderSection(
          'Channel Import / Export',
          'Save or restore Shakedex and Add On channel settings as a JSON file.',
          '',
          null,
          <div className="settings__channel-card__actions">
            <button
              className="settings__content__section__cta"
              onClick={this.exportChannelSettings}
            >
              Export Channels
            </button>
            <button
              className="settings__content__section__cta"
              onClick={this.importChannelSettings}
            >
              Import Channels
            </button>
          </div>,
        )}
      </>
    );
  }

  startNode = async () => {
    await connClient.setConnectionType(ConnectionTypes.P2P);
    await nodeClient.reset();
    await this.props.setCustomRPCStatus(false);
    await this.props.fetchWallet();
  }

  renderContent() {
    const {
      isRunning,
      history,
      spv,
      rsPort,
      nsPort,
      noDns,
      setNoDns,
      isChangingNodeStatus,
      isTestingCustomRPC,
      isCustomRPCConnected,
      locale,
    } = this.props;
    const {t} = this.context;

    return (
      <div className="settings__content">
        <Switch>
          <Route path="/settings/general">
            <>
              {this.renderSection(
                t('settingGeneralTitle'),
                t('settingGeneralDesc'),
                t('download'),
                this.onDownload,
              )}
              {this.renderSection(
                t('settingExplorerTitle'),
                t('settingExplorerDesc'),
                null,
                null,
                <ExplorerPicker />,
                false,
              )}
              {this.renderSection(
                t('settingIdleTitle'),
                <span>
                  {t('settingIdleDescription')}
                </span>,
                t('update'),
                () => history.push('/settings/general/max-idle'),
              )}
              {this.renderSection(
                t('settingLanguageTitle'),
                t('settingLanguageDesc'),
                null,
                null,
                <Dropdown
                  className="locale-dropdown"
                  items={languageDropdownItems}
                  onChange={this.onSetLocale}
                  currentIndex={languageDropdownItems.findIndex(item => item.value === locale)}
                />,
                false,
              )}
            </>
          </Route>
          <Route path="/settings/connection">
            <>
              {this.renderSection(
                t('settingNodeTitle'),
                !isCustomRPCConnected && isRunning
                  ? <><span className="node-status--active" /><span>{t('settingNodeRunning')}</span></>
                  : <><span className="node-status--inactive" /><span>{t('settingNodeNotRunning')}</span></>,
                t('settingNodeCTA'),
                this.startNode,
                <button
                  className="settings__view-api-btn"
                  disabled={!isRunning || isChangingNodeStatus || isTestingCustomRPC || isCustomRPCConnected}
                  onClick={() => history.push('/settings/connection/view-api-key')}
                >
                  {t('settingAPIKeyCTA')}
                </button>,
                isChangingNodeStatus || isTestingCustomRPC || !isCustomRPCConnected && isRunning,
                true
              )}
              {this.renderSection(
                t('settingSPVNodeTitle'),
                t('settingSPVNodeDesc'),
                spv ? t('disable') : t('enable'),
                async () => {
                  await nodeClient.setSpvMode(!spv);
                  await this.startNode();
                },
                null,
                isChangingNodeStatus || isTestingCustomRPC,
                true
              )}
              {this.renderSection(
                t('settingRemoteTitle'),
                isCustomRPCConnected && isRunning
                  ? <><span className="node-status--active" /><span>{t('settingRemoteConnected')}</span></>
                  : <><span className="node-status--inactive" />{t('settingRemoteConnectedHTTP')}</>,
                t('settingRemoteCTA'),
                () => history.push("/settings/connection/configure"),
                null,
                isCustomRPCConnected || isTestingCustomRPC || isChangingNodeStatus,
                true
              )}
              {this.renderSection(
                t('settingDNSTitle'),
                !isRunning || noDns
                  ? <><span className="node-status--inactive" /><span>{t('settingDNSNotRunning')}</span></>
                  : <><span className="node-status--active" /><span>{t('settingDNSRunning', nsPort.toString(), rsPort.toString())}</span></>,
                noDns ? t('enable') : t('disable'),
                () => {setNoDns(!noDns)},
                null,
                isChangingNodeStatus || isTestingCustomRPC || isCustomRPCConnected,
              )}
              {this.renderSection(
                t('settingHip2Title'),
                t('settingHip2Desc', rsPort.toString()),
                null,
                null,
                <Hip2Picker placeholder={t('settingHip2Placeholder')} />,
                null
              )}
              {this.renderSection(
                t('settingHSDDirTitle'),
                <div>
                  <div><small>{t('userDirectory')}: {this.state.userDir}</small></div>
                  <div><small>{t('hsdDirectory')}: {this.state.directory}</small></div>
                </div>,
                t('settingHSDDirCTA'),
                () => history.push("/settings/connection/changeDirectory"),
                null,
              )}
              {this.renderSection(
                t('settingNetTitle'),
                t('settingNetDesc'),
                null,
                null,
                <NetworkPicker />,
                isTestingCustomRPC || isChangingNodeStatus,
              )}
            </>
          </Route>
          <Route path="/settings/wallet">
            {this.renderWallet()}
          </Route>
          <Route path="/settings/exchange">
            {this.renderExchange()}
          </Route>
          <Route path="/settings/addons">
            {this.renderAddons()}
          </Route>
          <Route>
            <Redirect to="/settings/general" />
          </Route>
        </Switch>
        <div className="settings__footer">
          Bob v{pkg.version}
        </div>
      </div>
    )
  }

  render() {
    return (
      <ContentArea className="settings" noPadding>
        { this.renderNav() }
        { this.renderContent() }
        <Switch>
          <Route path="/settings/general/max-idle" component={MaxIdleModal} />
          <Route path="/settings/wallet/account-index" component={AccountIndexModal} />
          <Route
            path="/settings/wallet/remove-wallet"
            render={() => (
              <InterstitialWarningModal
                nextAction={async () => {
                  await walletClient.removeWalletById(this.props.wid);
                  this.props.history.push('/login');
                }}
                nextRoute="/"
              />
            )}
          />
          <Route path="/settings/wallet/account-key" component={AccountKeyModal} />
          <Route path="/settings/wallet/reveal-seed" component={RevealSeedModal} />
          <Route path="/settings/wallet/zap-txs" component={ZapTXsModal} />
          <Route path="/settings/connection/configure" component={CustomRPCConfigModal} />
          <Route path="/settings/connection/changeDirectory" component={ChangeDirectoryModal} />
          <Route path="/settings/wallet/view-api-key">
            <APIKeyModal
              closeRoute="/settings/wallet"
              title="Wallet API Key"
              apiKey={this.props.walletApiKey}
              updateAPIKey={walletClient.setAPIKey}
            />
          </Route>
          <Route path="/settings/connection/view-api-key">
            <APIKeyModal
              closeRoute="/settings/connection"
              title="Node API Key"
              apiKey={this.props.apiKey}
              updateAPIKey={nodeClient.setAPIKey}
            />
          </Route>
          <Route path="/settings/wallet/deep-clean-and-rescan">
            <DeepCleanAndRescanModal />
          </Route>
          <Route
            path="/settings/exchange/backup"
            render={() => (
              <BackupListingModal
                nextAction={this.onDownloadExchangeBackup}
                nextRoute="/settings/exchange"
              />
            )}
          />
        </Switch>
      </ContentArea>
    );
  }
}

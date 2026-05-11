import React, {Component} from 'react';
import {shell} from 'electron';
import {withRouter} from 'react-router-dom';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';
import {I18nContext} from '../../utils/i18n';
import DocsHelp from '../../components/DocsHelp';
import {
  DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
  LIQUIDITY_ADDON_NAME,
  LIQUIDITY_SPOT_CHANNEL_LIST_STORAGE_KEY,
  LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY,
  getLiquiditySpotChannelUrl,
  mergeLiquiditySpotChannels,
  normalizeLiquiditySpotHost,
} from '../../constants/liquiditySpotChannels';
import './addons.scss';

const ADDONS = [
  {
    name: 'Shakedex Marketplace',
    status: 'Available',
    description: 'Browse pending and active Shakedex channel listings from inside Bob.',
    action: 'Open',
    href: '/exchange',
    internal: true,
  },
  {
    name: LIQUIDITY_ADDON_NAME,
    status: 'Public Preview',
    description: 'Human P2P coordination is available now. Atomic-swap tooling is the next build track and will need Bitcoin wallet integration research.',
    action: 'Open',
    href: 'https://liquidity.spot/p2p',
    docsHref: 'https://bobwallet.org/docs/liquidity-spot',
    externalNotice: 'Liquidity opens outside Bob. Bob will not share your seed phrase, private keys, wallet password, or signing permissions with this Add On.',
    details: [
      'Guest P2P: browse, create, accept, and coordinate trades.',
      'GFAVIP optional: only needed for Gems and account benefits.',
      'Atomic swaps: planned Bitcoin/Electrum compatibility work.',
      'No Bob wallet permissions in this preview.',
    ],
  },
  {
    name: 'Resolver Directory',
    status: 'Planned',
    description: 'Find working Handshake resolvers and see their health before changing your setup.',
  },
  {
    name: 'Agentic Web',
    status: 'Research',
    description: 'Agent-friendly tools built around HNS TXT records and the hns.bio standard.',
  },
  {
    name: 'SLD Manager',
    status: 'Research',
    description: 'Help TLD owners run nameservers and manage second-level domains without DNS guesswork.',
  },
];

class Addons extends Component {
  static propTypes = {
    history: PropTypes.object.isRequired,
    deeplinkParams: PropTypes.object,
  };

  static contextType = I18nContext;

  state = {
    pendingExternalAddon: null,
    liquiditySpotHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
    liquiditySpotDraftHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
    liquiditySpotChannels: [],
    liquiditySpotChannelError: '',
  };

  componentDidMount() {
    const storedHost = normalizeLiquiditySpotHost(
      window.localStorage.getItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY),
    ) || DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST;
    const storedChannels = this.getStoredLiquiditySpotChannels();

    this.setState({
      liquiditySpotHost: storedHost,
      liquiditySpotDraftHost: storedHost,
      liquiditySpotChannels: mergeLiquiditySpotChannels(storedChannels),
    });
  }

  getStoredLiquiditySpotChannels() {
    try {
      return JSON.parse(window.localStorage.getItem(LIQUIDITY_SPOT_CHANNEL_LIST_STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  persistLiquiditySpotChannels(channels) {
    window.localStorage.setItem(LIQUIDITY_SPOT_CHANNEL_LIST_STORAGE_KEY, JSON.stringify(channels));
  }

  openAddon(addon) {
    if (!addon.href)
      return;

    if (addon.internal) {
      this.props.history.push(addon.href);
      return;
    }

    this.setState({pendingExternalAddon: addon});
  }

  saveLiquiditySpotChannel() {
    const host = normalizeLiquiditySpotHost(this.state.liquiditySpotDraftHost);
    if (!host) {
      this.setState({liquiditySpotChannelError: 'Enter a valid channel host.'});
      return;
    }

    window.localStorage.setItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY, host);
    const channels = mergeLiquiditySpotChannels([
      ...this.state.liquiditySpotChannels,
      {host, label: host},
    ]);
    this.persistLiquiditySpotChannels(channels);
    this.setState({
      liquiditySpotHost: host,
      liquiditySpotDraftHost: host,
      liquiditySpotChannels: channels,
      liquiditySpotChannelError: '',
    });
  }

  resetLiquiditySpotChannel() {
    window.localStorage.removeItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY);
    this.setState({
      liquiditySpotHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotDraftHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotChannels: mergeLiquiditySpotChannels(),
      liquiditySpotChannelError: '',
    });
  }

  confirmExternalAddon() {
    const {pendingExternalAddon} = this.state;

    if (!pendingExternalAddon)
      return;

    shell.openExternal(pendingExternalAddon.href);
    this.setState({pendingExternalAddon: null});
  }

  cancelExternalAddon() {
    this.setState({pendingExternalAddon: null});
  }

  openLiquiditySwapIntent() {
    const {deeplinkParams} = this.props;
    const intentUrl = deeplinkParams?.liquiditySwapIntentUrl;

    if (intentUrl) {
      shell.openExternal(intentUrl);
    }
  }

  openLiquiditySwapRoom() {
    const {deeplinkParams} = this.props;
    const intentUrl = deeplinkParams?.liquiditySwapIntentUrl;

    if (!intentUrl)
      return;

    try {
      const url = new URL(intentUrl);
      const match = url.pathname.match(/^\/api\/swaps\/(\d+)\/wallet-intents$/);
      if (match) {
        shell.openExternal(`${url.origin}/swaps/${match[1]}`);
        return;
      }
    } catch (e) {}

    shell.openExternal(intentUrl);
  }

  render() {
    const {t} = this.context;
    const {deeplinkParams} = this.props;
    const {
      pendingExternalAddon,
      liquiditySpotHost,
      liquiditySpotDraftHost,
      liquiditySpotChannels,
      liquiditySpotChannelError,
    } = this.state;
    const liquiditySwapIntentUrl = deeplinkParams?.liquiditySwapIntentUrl;
    const addons = ADDONS.map(addon => {
      if (addon.name !== LIQUIDITY_ADDON_NAME) {
        return addon;
      }

      return {
        ...addon,
        href: getLiquiditySpotChannelUrl(liquiditySpotHost),
        description: `Human P2P coordination from ${liquiditySpotHost}. Atomic-swap tooling is the next build track and will need Bitcoin wallet integration research.`,
      };
    });

    return (
      <div className="addons-page">
        <div className="addons-page__intro">
          <div>
            <h2>{t('moreAddonsTitle')}</h2>
            <p>{t('moreAddonsIntro')}</p>
          </div>
          <button
            className="addons-page__docs-button"
            onClick={() => shell.openExternal('https://bobwallet.org')}
          >
            {t('openDocs')}
          </button>
        </div>
        <DocsHelp
          title="Add Ons"
          href="https://bobwallet.org/docs/add-ons"
        >
          Add Ons are reviewed tools surfaced inside Bob. Native Add Ons stay in Bob; external Add Ons open outside Bob and never receive wallet secrets.
        </DocsHelp>
        <div className="addons-page__channel-card">
          <div>
            <h3>Liquidity Channel</h3>
            <p>
              Active channel: <strong>{liquiditySpotHost}</strong>. Guest P2P should be available without GFAVIP; GFAVIP is optional for Gems and account benefits.
            </p>
          </div>
          <div className="addons-page__channel-controls">
            <select
              value={liquiditySpotHost}
              onChange={event => {
                const host = event.target.value;
                window.localStorage.setItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY, host);
                this.setState({
                  liquiditySpotHost: host,
                  liquiditySpotDraftHost: host,
                  liquiditySpotChannelError: '',
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
              value={liquiditySpotDraftHost}
              onChange={event => this.setState({
                liquiditySpotDraftHost: event.target.value,
                liquiditySpotChannelError: '',
              })}
              placeholder="liquidity.spot"
            />
            <button onClick={() => this.saveLiquiditySpotChannel()}>
              Add/Save
            </button>
            <button onClick={() => this.resetLiquiditySpotChannel()}>
              Reset
            </button>
          </div>
          {liquiditySpotChannelError && (
            <div className="addons-page__channel-error">
              {liquiditySpotChannelError}
            </div>
          )}
        </div>
        {liquiditySwapIntentUrl && (
          <div className="addons-page__channel-card addons-page__swap-intent">
            <div>
              <h3>Liquidity Swap Intent Ready</h3>
              <p>
                Liquidity.spot sent Bob a swap intent. Bob can inspect the HNS-side terms here first; signing/broadcasting still stays inside your local wallet.
              </p>
              <code>{liquiditySwapIntentUrl}</code>
            </div>
            <div className="addons-page__channel-controls">
              <button onClick={() => this.openLiquiditySwapIntent()}>
                Open Intent JSON
              </button>
              <button onClick={() => this.openLiquiditySwapRoom()}>
                Open Swap Room
              </button>
            </div>
          </div>
        )}
        <div className="addons-page__grid">
          {addons.map(addon => (
            <div className="addons-page__card" key={addon.name}>
              <div className="addons-page__card-header">
                <h3>{addon.name}</h3>
                <span>{addon.status}</span>
              </div>
              <p>{addon.description}</p>
              {addon.details && (
                <ul className="addons-page__details">
                  {addon.details.map(detail => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
              <div className="addons-page__actions">
                {addon.href && (
                  <button onClick={() => this.openAddon(addon)}>
                    {addon.action}
                  </button>
                )}
                {addon.docsHref && (
                  <button onClick={() => shell.openExternal(addon.docsHref)}>
                    {t('openDocs')}
                  </button>
                )}
              </div>
              {pendingExternalAddon?.name === addon.name && (
                <div className="addons-page__external-notice">
                  <h4>Open External Add On?</h4>
                  <p>{addon.externalNotice || 'This Add On opens outside Bob.'}</p>
                  <div className="addons-page__notice-actions">
                    <button onClick={() => this.confirmExternalAddon()}>
                      Continue
                    </button>
                    <button onClick={() => this.cancelExternalAddon()}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
}

export default withRouter(connect(
  state => ({
    deeplinkParams: state.app.deeplinkParams,
  }),
)(Addons));

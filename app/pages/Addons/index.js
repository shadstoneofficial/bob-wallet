import React, {Component} from 'react';
import {shell} from 'electron';
import {withRouter} from 'react-router-dom';
import PropTypes from 'prop-types';
import {I18nContext} from '../../utils/i18n';
import DocsHelp from '../../components/DocsHelp';
import {
  DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
  getLiquiditySpotChannelUrl,
  normalizeLiquiditySpotHost,
} from '../../constants/liquiditySpotChannels';
import './addons.scss';

const LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY = 'bob:liquiditySpotChannelHost';

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
    name: 'Liquidity Spot',
    status: 'Public Preview',
    description: 'Human P2P coordination is available now. Atomic-swap tooling is the next build track and will need Bitcoin wallet integration research.',
    action: 'Open',
    href: 'https://liquidity.spot/p2p',
    docsHref: 'https://bobwallet.org/docs/liquidity-spot',
    externalNotice: 'Liquidity Spot opens outside Bob. Bob will not share your seed phrase, private keys, wallet password, or signing permissions with this Add On.',
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
  };

  static contextType = I18nContext;

  state = {
    pendingExternalAddon: null,
    liquiditySpotHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
    liquiditySpotDraftHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
    liquiditySpotChannelError: '',
  };

  componentDidMount() {
    const storedHost = normalizeLiquiditySpotHost(
      window.localStorage.getItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY),
    ) || DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST;

    this.setState({
      liquiditySpotHost: storedHost,
      liquiditySpotDraftHost: storedHost,
    });
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
    this.setState({
      liquiditySpotHost: host,
      liquiditySpotDraftHost: host,
      liquiditySpotChannelError: '',
    });
  }

  resetLiquiditySpotChannel() {
    window.localStorage.removeItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY);
    this.setState({
      liquiditySpotHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotDraftHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotChannelError: '',
    });
  }

  confirmExternalAddon() {
    const {
      pendingExternalAddon,
      liquiditySpotHost,
      liquiditySpotDraftHost,
      liquiditySpotChannelError,
    } = this.state;
    const addons = ADDONS.map(addon => {
      if (addon.name !== 'Liquidity Spot') {
        return addon;
      }

      return {
        ...addon,
        href: getLiquiditySpotChannelUrl(liquiditySpotHost),
        description: `Human P2P coordination from ${liquiditySpotHost}. Atomic-swap tooling is the next build track and will need Bitcoin wallet integration research.`,
      };
    });

    if (!pendingExternalAddon)
      return;

    shell.openExternal(pendingExternalAddon.href);
    this.setState({pendingExternalAddon: null});
  }

  cancelExternalAddon() {
    this.setState({pendingExternalAddon: null});
  }

  render() {
    const {t} = this.context;
    const {pendingExternalAddon} = this.state;

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
            <h3>Liquidity Spot Channel</h3>
            <p>
              Active channel: <strong>{liquiditySpotHost}</strong>. If liquidity.spot is unavailable, users can point Bob at another compatible Liquidity Spot channel.
            </p>
          </div>
          <div className="addons-page__channel-controls">
            <input
              value={liquiditySpotDraftHost}
              onChange={event => this.setState({
                liquiditySpotDraftHost: event.target.value,
                liquiditySpotChannelError: '',
              })}
              placeholder="liquidity.spot"
            />
            <button onClick={() => this.saveLiquiditySpotChannel()}>
              Save Channel
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
              {pendingExternalAddon === addon && (
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

export default withRouter(Addons);

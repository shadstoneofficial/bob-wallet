import React, {Component} from 'react';
import {shell} from 'electron';
import {withRouter} from 'react-router-dom';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';
import {I18nContext} from '../../utils/i18n';
import DocsHelp from '../../components/DocsHelp';
import walletClient from '../../utils/walletClient';
import {clientStub as settingClientStub} from '../../background/setting/client';
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
import {
  getLiquiditySwapRoomUrl,
  getSafeLiquidityIntentUrl,
} from '../../utils/urlPolicy';

const settingClient = settingClientStub(() => require('electron').ipcRenderer);

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
    name: 'Send Name',
    status: 'Available',
    description: 'Send or sell a domain directly to another user with a paid claim payload.',
    action: 'Open',
    href: '/send?asset=name&mode=send',
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
    location: PropTypes.object.isRequired,
    deeplinkParams: PropTypes.object,
  };

  static contextType = I18nContext;

  state = {
    pendingExternalAddon: null,
    liquiditySpotHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
    liquiditySpotDraftHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
    liquiditySpotChannels: [],
    liquiditySpotChannelError: '',
    liquiditySwapIntent: null,
    liquiditySwapIntentLoading: false,
    liquiditySwapIntentError: '',
    liquiditySwapActionNotice: '',
    liquiditySwapLocalKeys: {},
    liquiditySwapActionLoading: false,
    liquidityChannel: null,
    liquidityChannelLoading: false,
    liquidityChannelError: '',
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
    this.loadLiquidityChannel(storedHost);
    this.loadLiquiditySwapIntent(this.props.deeplinkParams?.liquiditySwapIntentUrl);
  }

  componentDidUpdate(prevProps) {
    const previousIntentUrl = prevProps.deeplinkParams?.liquiditySwapIntentUrl;
    const currentIntentUrl = this.props.deeplinkParams?.liquiditySwapIntentUrl;

    if (previousIntentUrl !== currentIntentUrl) {
      this.loadLiquiditySwapIntent(currentIntentUrl);
    }
  }

  async loadLiquidityChannel(host = this.state.liquiditySpotHost) {
    this.setState({
      liquidityChannelLoading: true,
      liquidityChannelError: '',
    });

    try {
      const channel = await settingClient.getLiquidityChannel(host);

      this.setState({
        liquidityChannel: channel,
        liquidityChannelLoading: false,
      });
    } catch (e) {
      this.setState({
        liquidityChannel: null,
        liquidityChannelLoading: false,
        liquidityChannelError: e.message || 'Unable to load the Liquidity channel.',
      });
    }
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
    }, () => this.loadLiquidityChannel(host));
  }

  resetLiquiditySpotChannel() {
    window.localStorage.removeItem(LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY);
    this.setState({
      liquiditySpotHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotDraftHost: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
      liquiditySpotChannels: mergeLiquiditySpotChannels(),
      liquiditySpotChannelError: '',
    }, () => this.loadLiquidityChannel(DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST));
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

    const safeIntentUrl = getSafeLiquidityIntentUrl(intentUrl);
    if (safeIntentUrl) {
      shell.openExternal(safeIntentUrl);
    }
  }

  openLiquiditySwapRoom() {
    const {deeplinkParams} = this.props;
    const intentUrl = deeplinkParams?.liquiditySwapIntentUrl;

    const roomUrl = getLiquiditySwapRoomUrl(intentUrl);
    if (!roomUrl)
      return;
    shell.openExternal(roomUrl);
  }

  openLiquidityChannelPath(path) {
    shell.openExternal(getLiquiditySpotChannelUrl(this.state.liquiditySpotHost, path));
  }

  async loadLiquiditySwapIntent(intentUrl) {
    const safeIntentUrl = getSafeLiquidityIntentUrl(intentUrl);
    if (!safeIntentUrl) {
      this.setState({
        liquiditySwapIntent: null,
        liquiditySwapIntentLoading: false,
        liquiditySwapIntentError: '',
        liquiditySwapActionNotice: '',
      });
      return;
    }

    this.setState({
      liquiditySwapIntent: null,
      liquiditySwapIntentLoading: true,
      liquiditySwapIntentError: '',
      liquiditySwapActionNotice: '',
    });

    try {
      const response = await fetch(safeIntentUrl);

      if (!response.ok)
        throw new Error(`Liquidity.spot returned ${response.status}`);

      const intent = await response.json();

      this.setState({
        liquiditySwapIntent: intent,
        liquiditySwapLocalKeys: this.getStoredLiquiditySwapKeys(intent.swap_id),
        liquiditySwapIntentLoading: false,
      });
    } catch (e) {
      this.setState({
        liquiditySwapIntentLoading: false,
        liquiditySwapIntentError: e.message || 'Unable to load the Liquidity.spot swap intent.',
      });
    }
  }

  prepareLiquiditySwapAction(action) {
    this.setState({
      liquiditySwapActionNotice: `${action} is ready for the next Bob wallet-service step. This screen is intentionally preview-only until Bob has a regtest-proven HNS HTLC builder, local signing prompt, and broadcast callback.`,
    });
  }

  getLiquiditySwapKeyStorageKey(swapId) {
    return `liquiditySwap/${swapId}/hnsKeys`;
  }

  getStoredLiquiditySwapKeys(swapId) {
    if (!swapId)
      return {};

    try {
      return JSON.parse(window.localStorage.getItem(this.getLiquiditySwapKeyStorageKey(swapId)) || '{}');
    } catch (e) {
      return {};
    }
  }

  storeLiquiditySwapKeys(swapId, keys) {
    if (!swapId)
      return;

    window.localStorage.setItem(this.getLiquiditySwapKeyStorageKey(swapId), JSON.stringify(keys));
    this.setState({liquiditySwapLocalKeys: keys});
  }

  async postLiquiditySwapMetadata(payload) {
    const {liquiditySwapIntent} = this.state;
    const metadataUrl = liquiditySwapIntent?.hns_lock?.metadata_callback?.url
      || liquiditySwapIntent?.claims?.bob_hns_claim?.metadata_callback?.url;

    if (!metadataUrl)
      throw new Error('This intent does not include an HNS metadata callback.');

    const response = await fetch(metadataUrl, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok)
      throw new Error(data.error || `Liquidity.spot returned ${response.status}`);

    await this.loadLiquiditySwapIntent(this.props.deeplinkParams?.liquiditySwapIntentUrl);
    return data;
  }

  async postLiquiditySwapTxid(callback, payload) {
    if (!callback?.url)
      throw new Error('This intent does not include a TXID callback.');

    const response = await fetch(callback.url, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok)
      throw new Error(data.error || `Liquidity.spot returned ${response.status}`);

    await this.loadLiquiditySwapIntent(this.props.deeplinkParams?.liquiditySwapIntentUrl);
    return data;
  }

  async generateLiquidityHnsKey(kind) {
    const {liquiditySwapIntent, liquiditySwapLocalKeys} = this.state;

    if (!liquiditySwapIntent)
      return;

    this.setState({liquiditySwapActionLoading: true, liquiditySwapActionNotice: ''});

    try {
      const key = await walletClient.createLiquidityHnsSwapKey();
      const nextKeys = {
        ...liquiditySwapLocalKeys,
        [kind]: key,
      };
      this.storeLiquiditySwapKeys(liquiditySwapIntent.swap_id, nextKeys);

      const payload = kind === 'claim'
        ? {hns_claim_public_key: key.publicKey}
        : {hns_refund_public_key: key.publicKey};
      await this.postLiquiditySwapMetadata(payload);
      this.setState({
        liquiditySwapActionNotice: `${kind === 'claim' ? 'Bob claim' : 'Alice refund'} HNS key saved to this wallet and sent to Liquidity.spot.`,
      });
    } catch (e) {
      this.setState({liquiditySwapActionNotice: e.message || 'Could not generate HNS swap key.'});
    } finally {
      this.setState({liquiditySwapActionLoading: false});
    }
  }

  async lockLiquidityHns() {
    const {liquiditySwapIntent, liquiditySwapLocalKeys} = this.state;
    const hnsLock = liquiditySwapIntent?.hns_lock || {};
    const refundKey = liquiditySwapLocalKeys.refund;

    this.setState({liquiditySwapActionLoading: true, liquiditySwapActionNotice: ''});

    try {
      if (!refundKey?.publicKey)
        throw new Error('Generate the Alice refund key in this wallet before locking HNS.');
      if (!hnsLock.claim_public_key)
        throw new Error('Waiting for Bob claim public key before locking HNS.');

      const lock = await walletClient.createLiquidityHnsLock({
        amountDollary: hnsLock.amount_dollary,
        secretHash: hnsLock.secret_hash_sha256,
        claimPublicKey: hnsLock.claim_public_key,
        refundPublicKey: refundKey.publicKey,
        refundLocktime: hnsLock.refund_locktime,
        timelockBlocksEstimate: hnsLock.timelock_blocks_estimate,
      });

      await this.postLiquiditySwapMetadata({
        hns_refund_public_key: refundKey.publicKey,
        hns_lock_address: lock.htlcAddress,
        hns_lock_script: lock.htlcScript,
        hns_lock_value: lock.value,
        hns_lock_output_index: lock.htlcOutputIndex,
        hns_refund_locktime: lock.refundLocktime,
      });
      await this.postLiquiditySwapTxid(hnsLock.callback, {
        txid: lock.txid,
        hns_lock_address: lock.htlcAddress,
        hns_lock_script: lock.htlcScript,
        hns_lock_value: lock.value,
        hns_lock_output_index: lock.htlcOutputIndex,
        hns_refund_locktime: lock.refundLocktime,
      });
      this.setState({liquiditySwapActionNotice: `HNS lock broadcast and submitted: ${lock.txid}`});
    } catch (e) {
      this.setState({liquiditySwapActionNotice: e.message || 'Could not lock HNS.'});
    } finally {
      this.setState({liquiditySwapActionLoading: false});
    }
  }

  async claimLiquidityHns() {
    const {liquiditySwapIntent, liquiditySwapLocalKeys} = this.state;
    const bobClaim = liquiditySwapIntent?.claims?.bob_hns_claim || {};
    const claimKey = liquiditySwapLocalKeys.claim;

    this.setState({liquiditySwapActionLoading: true, liquiditySwapActionNotice: ''});

    try {
      if (!claimKey?.address)
        throw new Error('Generate the Bob claim key in this wallet before claiming HNS.');
      if (!bobClaim.revealed_secret)
        throw new Error('Waiting for Alice to reveal the secret on the BTC claim.');
      if (!bobClaim.alice_lock_txid || bobClaim.alice_lock_output_index == null)
        throw new Error('Waiting for Alice HNS lock TXID and output index.');

      const claim = await walletClient.createLiquidityHnsClaim({
        txid: bobClaim.alice_lock_txid,
        index: bobClaim.alice_lock_output_index,
        signerAddress: claimKey.address,
        secret: bobClaim.revealed_secret,
        secretHash: bobClaim.secret_hash_sha256,
        claimPublicKey: claimKey.publicKey,
        refundPublicKey: bobClaim.refund_public_key,
        refundLocktime: bobClaim.refund_locktime,
      });

      await this.postLiquiditySwapTxid(bobClaim.callback, {txid: claim.txid});
      this.setState({liquiditySwapActionNotice: `HNS claim broadcast and submitted: ${claim.txid}`});
    } catch (e) {
      this.setState({liquiditySwapActionNotice: e.message || 'Could not claim HNS.'});
    } finally {
      this.setState({liquiditySwapActionLoading: false});
    }
  }

  renderLiquiditySwapIntentDetails(intent) {
    if (!intent)
      return null;

    const hnsLock = intent.hns_lock || {};
    const btcLock = intent.btc_lock || {};
    const bobClaim = intent.claims?.bob_hns_claim || {};
    const hnsHtlc = intent.hns_htlc || {};
    const amounts = intent.amounts || {};
    const participants = intent.participants || {};

    return (
      <>
        <dl className="addons-page__swap-intent-details">
          <div>
            <dt>Swap</dt>
            <dd>#{intent.swap_id || 'Pending'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{intent.status || 'Unknown'}</dd>
          </div>
          <div>
            <dt>HNS Amount</dt>
            <dd>{amounts.hns || hnsLock.amount_hns || '-'}</dd>
          </div>
          <div>
            <dt>BTC Amount</dt>
            <dd>{amounts.btc || btcLock.amount_btc || '-'}</dd>
          </div>
          <div>
            <dt>Alice</dt>
            <dd>{participants.alice_user_id || '-'}</dd>
          </div>
          <div>
            <dt>Bob</dt>
            <dd>{participants.bob_user_id || '-'}</dd>
          </div>
        </dl>
        <div className="addons-page__swap-intent-section">
          <h4>HNS Lock Terms</h4>
          <dl className="addons-page__swap-intent-details">
            <div>
              <dt>Secret Hash</dt>
              <dd>{intent.secret_hash_sha256 || hnsLock.secret_hash_sha256 || '-'}</dd>
            </div>
            <div>
              <dt>Timelock</dt>
              <dd>{hnsLock.timelock_blocks ? `${hnsLock.timelock_blocks} blocks` : '-'}</dd>
            </div>
            <div>
              <dt>Bob Claim Key</dt>
              <dd>{hnsLock.claim_public_key || hnsHtlc.claim_public_key || 'Waiting for Bob'}</dd>
            </div>
            <div>
              <dt>Alice Refund Key</dt>
              <dd>{hnsLock.refund_public_key || hnsHtlc.refund_public_key || 'Waiting for Alice'}</dd>
            </div>
            <div>
              <dt>HTLC Address</dt>
              <dd>{hnsLock.htlc_address || hnsHtlc.lock_address || '-'}</dd>
            </div>
            <div>
              <dt>Callback</dt>
              <dd>{hnsLock.callback?.url || '-'}</dd>
            </div>
          </dl>
        </div>
        <div className="addons-page__swap-intent-section">
          <h4>Claim Terms</h4>
          <dl className="addons-page__swap-intent-details">
            <div>
              <dt>Revealed Secret</dt>
              <dd>{bobClaim.revealed_secret || 'Not revealed yet'}</dd>
            </div>
            <div>
              <dt>Lock Output</dt>
              <dd>{bobClaim.alice_lock_output_index ?? hnsHtlc.lock_output_index ?? 'Waiting for Alice lock'}</dd>
            </div>
            <div>
              <dt>Callback</dt>
              <dd>{bobClaim.callback?.url || '-'}</dd>
            </div>
          </dl>
        </div>
      </>
    );
  }

  renderLiquidityChannelListings() {
    const {liquidityChannel, liquidityChannelLoading, liquidityChannelError} = this.state;
    const p2pOffers = liquidityChannel?.p2p?.offers || [];
    const atomicOrders = liquidityChannel?.atomic_swaps?.orders || [];

    return (
      <div className="addons-page__liquidity-channel">
        <div className="addons-page__channel-card">
          <div className="addons-page__liquidity-header">
            <div>
              <h3>Source Channel</h3>
              <p>
                Native listings pulled from {liquidityChannel?.name || this.state.liquiditySpotHost}. Accepting, posting, and trade chat still open on the source channel.
              </p>
            </div>
            <button onClick={() => this.loadLiquidityChannel()}>
              Refresh
            </button>
          </div>
          {liquidityChannelLoading && (
            <div className="addons-page__swap-intent-message">
              Loading channel listings...
            </div>
          )}
          {liquidityChannelError && (
            <div className="addons-page__channel-error">
              {liquidityChannelError}
            </div>
          )}
          {liquidityChannel?.requirements?.bob_wallet && (
            <div className="addons-page__swap-intent-message">
              {liquidityChannel.requirements.bob_wallet}{' '}
              <button onClick={() => shell.openExternal(liquidityChannel.requirements.bob_wallet_download_url)}>
                Download Bob
              </button>
            </div>
          )}
        </div>
        <div className="addons-page__listing-grid">
          {this.renderLiquidityListingTable({
            title: 'P2P Offers',
            empty: 'No open P2P offers on this channel.',
            rows: p2pOffers,
            type: 'p2p',
            actionLabel: 'Open P2P',
            fallbackPath: '/p2p',
          })}
          {this.renderLiquidityListingTable({
            title: 'Atomic Swap Orders',
            empty: 'No open atomic swap orders on this channel.',
            rows: atomicOrders,
            type: 'atomic',
            actionLabel: 'Open Orders',
            fallbackPath: '/orders',
          })}
        </div>
      </div>
    );
  }

  renderLiquidityListingTable({title, empty, rows, type, actionLabel, fallbackPath}) {
    return (
      <div className="addons-page__channel-card addons-page__listing-card">
        <div className="addons-page__liquidity-header">
          <h3>{title}</h3>
          <button onClick={() => this.openLiquidityChannelPath(fallbackPath)}>
            {actionLabel}
          </button>
        </div>
        {rows.length ? (
          <div className="addons-page__listing-table-wrap">
            <table className="addons-page__listing-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Side</th>
                  <th>Amount</th>
                  <th>Price</th>
                  <th>Stake</th>
                  {type === 'p2p' && <th>Method</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={`${type}-${row.id}`}>
                    <td>{row.creator?.username || row.user?.username || 'Unknown'}</td>
                    <td className={`addons-page__side addons-page__side--${row.side}`}>
                      {row.side}
                    </td>
                    <td>{row.amount_hns} HNS</td>
                    <td>{row.price_btc_per_hns} BTC</td>
                    <td>{row.gems_stake || 0}</td>
                    {type === 'p2p' && <td>{row.payment_method || '-'}</td>}
                    <td>
                      <button onClick={() => shell.openExternal(row.url || getLiquiditySpotChannelUrl(this.state.liquiditySpotHost, fallbackPath))}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{empty}</p>
        )}
      </div>
    );
  }

  render() {
    const {t} = this.context;
    const {deeplinkParams, location} = this.props;
    const {
      pendingExternalAddon,
      liquiditySpotHost,
      liquiditySpotDraftHost,
      liquiditySpotChannels,
      liquiditySpotChannelError,
      liquiditySwapIntent,
      liquiditySwapIntentLoading,
      liquiditySwapIntentError,
      liquiditySwapActionNotice,
      liquiditySwapLocalKeys,
      liquiditySwapActionLoading,
    } = this.state;
    const liquiditySwapIntentUrl = deeplinkParams?.liquiditySwapIntentUrl;
    const isLiquiditySwapPage = location.pathname === '/liquidity-swap';
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
        {!isLiquiditySwapPage && (
          <>
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
          </>
        )}
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
                }, () => this.loadLiquidityChannel(host));
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
        {isLiquiditySwapPage && this.renderLiquidityChannelListings()}
        {liquiditySwapIntentUrl && (
          <div className="addons-page__channel-card addons-page__swap-intent">
            <div>
              <h3>Liquidity Swap Intent Ready</h3>
              <p>
                Liquidity.spot sent Bob a swap intent. Bob can inspect the HNS-side terms here first; signing and broadcasting will stay inside your local wallet.
              </p>
              <code>{liquiditySwapIntentUrl}</code>
            </div>
            {liquiditySwapIntentLoading && (
              <div className="addons-page__swap-intent-message">
                Loading swap terms...
              </div>
            )}
            {liquiditySwapIntentError && (
              <div className="addons-page__channel-error">
                {liquiditySwapIntentError}
              </div>
            )}
            {this.renderLiquiditySwapIntentDetails(liquiditySwapIntent)}
            {liquiditySwapActionNotice && (
              <div className="addons-page__swap-intent-message">
                {liquiditySwapActionNotice}
              </div>
            )}
            <div className="addons-page__swap-intent-actions">
              <button
                disabled={liquiditySwapActionLoading || !liquiditySwapIntent?.hns_lock}
                onClick={() => this.generateLiquidityHnsKey('claim')}
              >
                Generate Bob Claim Key
              </button>
              <button
                disabled={liquiditySwapActionLoading || !liquiditySwapIntent?.hns_lock}
                onClick={() => this.generateLiquidityHnsKey('refund')}
              >
                Generate Alice Refund Key
              </button>
              <button
                disabled={
                  liquiditySwapActionLoading
                  || !liquiditySwapIntent?.hns_lock?.claim_public_key
                  || !liquiditySwapLocalKeys.refund?.publicKey
                }
                onClick={() => this.lockLiquidityHns()}
              >
                Lock HNS
              </button>
              <button
                disabled={
                  liquiditySwapActionLoading
                  || !liquiditySwapIntent?.claims?.bob_hns_claim?.revealed_secret
                  || !liquiditySwapLocalKeys.claim?.address
                }
                onClick={() => this.claimLiquidityHns()}
              >
                Claim HNS
              </button>
              <button onClick={() => this.openLiquiditySwapIntent()}>
                Open Intent JSON
              </button>
              <button onClick={() => this.openLiquiditySwapRoom()}>
                Open Swap Room
              </button>
            </div>
          </div>
        )}
        {isLiquiditySwapPage && !liquiditySwapIntentUrl && (
          <div className="addons-page__channel-card addons-page__swap-intent">
            <div>
              <h3>No Liquidity Swap Intent</h3>
              <p>
                Open a Liquidity.spot swap from the website to send Bob a signed wallet-intent URL. The swap controls will appear here after Bob receives that link.
              </p>
            </div>
          </div>
        )}
        {!isLiquiditySwapPage && (
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
        )}
      </div>
    );
  }
}

export default withRouter(connect(
  state => ({
    deeplinkParams: state.app.deeplinkParams,
  }),
)(Addons));

import fs from 'fs';
import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { Address } from 'hsd/lib/primitives';
import * as networks from 'hsd/lib/protocol/networks';
import { consensus } from 'hsd/lib/protocol';
import Alert from '../../components/Alert';
import AddressInput from '../../components/AddressInput';
import Dropdown from '../../components/Dropdown';
import { getMyNames } from '../../ducks/myDomains';
import {
  claimPaidTransfer,
  finalizeTransfer,
  finalizeWithPayment,
  sendTransfer,
} from '../../ducks/names';
import { hasAddress } from '../../ducks/walletActions';
import nodeClient from '../../utils/nodeClient';
import walletClient from '../../utils/walletClient';
import isValidAddress from '../../utils/verifyAddress';
import {
  buildPaidNameTransferPayload,
  inspectPaidNameTransfer,
  parsePaidNameTransferInput,
  stringifyPaidNameTransferPayload,
} from '../../utils/paidNameTransfer';
import BulkTransfer from '../DomainManager/BulkTransfer';
import './send-name.scss';

const { dialog } = require('electron');

const SELL_MODE = 'send';
const CLAIM_MODE = 'claim';
const HISTORY_KEY_PREFIX = 'sendName/history';
const DOMAIN_SORTS = [
  {label: 'Name A-Z', value: 'name-asc'},
  {label: 'Name Z-A', value: 'name-desc'},
  {label: 'Expiration Soonest', value: 'expiration-asc'},
  {label: 'Expiration Latest', value: 'expiration-desc'},
];

class SendName extends Component {
  static propTypes = {
    mode: PropTypes.string,
    names: PropTypes.object.isRequired,
    height: PropTypes.number.isRequired,
    network: PropTypes.string.isRequired,
    walletId: PropTypes.string.isRequired,
    isFetching: PropTypes.bool.isRequired,
    getMyNames: PropTypes.func.isRequired,
    sendTransfer: PropTypes.func.isRequired,
    finalizeTransfer: PropTypes.func.isRequired,
    finalizeWithPayment: PropTypes.func.isRequired,
    claimPaidTransfer: PropTypes.func.isRequired,
    hasAddress: PropTypes.func.isRequired,
    setMode: PropTypes.func.isRequired,
  };

  state = {
    selectedName: '',
    domainQuery: '',
    domainSort: 'name-asc',
    buyerAddress: '',
    price: '',
    note: '',
    sellerError: '',
    sellerNotice: '',
    isStartingTransfer: false,
    isFinalizingTransfer: false,
    isCreatingPayload: false,
    payloadText: '',
    history: [],
    transferTo: '',
    resolvingTransferTo: false,
    claimText: '',
    claimError: '',
    claimNotice: '',
    claimDetails: null,
    claimIsOwnAddress: false,
    isClaiming: false,
    isShowingBulkTransfer: false,
  };

  componentDidMount() {
    this.props.getMyNames();
    this.setState({history: this.loadHistory()});
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      prevProps.walletId !== this.props.walletId
      || prevProps.network !== this.props.network
    ) {
      this.setState({
        history: this.loadHistory(),
        payloadText: '',
        sellerError: '',
        sellerNotice: '',
        claimError: '',
        claimNotice: '',
      });
    }

    if (
      this.state.selectedName
      && this.state.selectedName !== prevState.selectedName
    ) {
      this.resolveSelectedTransferTo();
    }
  }

  getHistoryKey() {
    return [
      HISTORY_KEY_PREFIX,
      this.props.network || 'unknown-network',
      this.props.walletId || 'unknown-wallet',
    ].join('/');
  }

  loadHistory() {
    try {
      return JSON.parse(window.localStorage.getItem(this.getHistoryKey()) || '[]');
    } catch (e) {
      return [];
    }
  }

  saveHistory(entry) {
    const history = [
      {
        createdAt: new Date().toISOString(),
        walletId: this.props.walletId,
        network: this.props.network,
        ...entry,
      },
      ...this.state.history,
    ].slice(0, 20);

    window.localStorage.setItem(this.getHistoryKey(), JSON.stringify(history));
    this.setState({history});
  }

  getSelectedDomain() {
    return this.props.names[this.state.selectedName] || null;
  }

  getDomainOptions() {
    const query = this.state.domainQuery.trim().toLowerCase();
    let names = Object.keys(this.props.names);

    if (query) {
      names = names.filter(name => name.toLowerCase().includes(query));
    }

    return names.sort((a, b) => {
      const nameCompare = a.localeCompare(b);

      if (this.state.domainSort === 'name-desc') {
        return -nameCompare;
      }

      if (this.state.domainSort === 'expiration-asc' || this.state.domainSort === 'expiration-desc') {
        const expirationCompare = this.getExpirationHeight(a) - this.getExpirationHeight(b);
        if (expirationCompare !== 0) {
          return this.state.domainSort === 'expiration-asc'
            ? expirationCompare
            : -expirationCompare;
        }
      }

      return nameCompare;
    });
  }

  getExpirationHeight(name) {
    const domain = this.props.names[name];
    const network = networks[this.props.network];

    if (!domain || !domain.renewal || !network || !network.names || !network.names.renewalWindow) {
      return Number.MAX_SAFE_INTEGER;
    }

    return domain.renewal + network.names.renewalWindow;
  }

  getRemainingBlocks(domain) {
    if (!domain || !domain.transfer) {
      return null;
    }

    const lockup = networks[this.props.network].names.transferLockup;
    return (domain.transfer + lockup) - this.props.height;
  }

  isTransferMature(domain) {
    const remaining = this.getRemainingBlocks(domain);
    return Number.isFinite(remaining) && remaining <= 0;
  }

  isTransferPending(domain) {
    const remaining = this.getRemainingBlocks(domain);
    return Number.isFinite(remaining) && remaining > 0;
  }

  processPrice(value) {
    if (value === '') {
      this.setState({price: '', sellerError: ''});
      return;
    }

    const price = `${value}`.match(/[0-9]*\.?[0-9]{0,6}/g)[0];
    if (Number.isNaN(parseFloat(price)))
      return;
    if (price * consensus.COIN > consensus.MAX_MONEY)
      return;
    this.setState({price, sellerError: ''});
  }

  getTxHash(result) {
    if (!result) {
      return '';
    }

    if (result.hash) {
      return result.hash;
    }

    if (result.txid) {
      return result.txid;
    }

    if (result.toJSON) {
      const json = result.toJSON();
      return (json && (json.hash || json.txid)) || '';
    }

    return '';
  }

  resolveSelectedTransferTo = async () => {
    const domain = this.getSelectedDomain();
    this.setState({transferTo: '', sellerError: ''});

    if (!domain || !domain.transfer) {
      return;
    }

    this.setState({resolvingTransferTo: true});

    try {
      const result = await nodeClient.getNameInfo(this.state.selectedName);
      const info = result && result.info;
      if (!info || !info.owner) {
        throw new Error('Could not read transfer owner information.');
      }

      const res = await walletClient.getTX(info.owner.hash);
      const coin = await walletClient.getCoin(info.owner.hash, info.owner.index);
      if (!res || !coin || coin.covenant.action !== 'TRANSFER') {
        throw new Error('Could not find the active transfer coin.');
      }

      const transferTo = Address.fromHash(
        Buffer.from(coin.covenant.items[3], 'hex'),
        Number(coin.covenant.items[2]),
      ).toString(this.props.network);

      this.setState({transferTo});
    } catch (e) {
      this.setState({
        sellerError: e.message || 'Could not resolve the transfer recipient.',
      });
    } finally {
      this.setState({resolvingTransferTo: false});
    }
  };

  onStartTransfer = async () => {
    const {selectedName, buyerAddress, price, note} = this.state;

    if (!selectedName || !buyerAddress) {
      this.setState({sellerError: 'Choose a domain and recipient address.'});
      return;
    }

    if (!isValidAddress(buyerAddress, this.props.network)) {
      this.setState({sellerError: 'Enter a valid address for the active network.'});
      return;
    }

    this.setState({
      isStartingTransfer: true,
      sellerError: '',
      sellerNotice: '',
    });

    try {
      const res = await this.props.sendTransfer(selectedName, buyerAddress);
      const txHash = this.getTxHash(res);
      this.saveHistory({
        type: 'transfer-started',
        name: selectedName,
        buyerAddress,
        price,
        note,
        txHash,
      });
      this.setState({
        sellerNotice: price
          ? `Transfer submitted${txHash ? `: ${txHash}` : ''}. Wait for the transfer lockup, then create the paid claim payload.`
          : `Transfer submitted${txHash ? `: ${txHash}` : ''}. Wait for the transfer lockup, then finalize the transfer from this screen.`,
      });
      this.props.getMyNames();
    } catch (e) {
      this.setState({sellerError: e.message || 'Could not start transfer.'});
    } finally {
      this.setState({isStartingTransfer: false});
    }
  };

  onFinalizeTransfer = async () => {
    const {selectedName} = this.state;
    const domain = this.getSelectedDomain();

    if (!selectedName || !domain || !this.isTransferMature(domain)) {
      this.setState({sellerError: 'This transfer is not ready to finalize yet.'});
      return;
    }

    this.setState({
      isFinalizingTransfer: true,
      sellerError: '',
      sellerNotice: '',
    });

    try {
      const res = await this.props.finalizeTransfer(selectedName);
      const txHash = this.getTxHash(res);
      this.saveHistory({
        type: 'transfer-finalized',
        name: selectedName,
        buyerAddress: this.state.transferTo,
        txHash,
      });
      this.setState({
        sellerNotice: `Transfer finalized${txHash ? `: ${txHash}` : ''}. The domain is now sent to the recipient address.`,
      });
      this.props.getMyNames();
    } catch (e) {
      this.setState({sellerError: e.message || 'Could not finalize transfer.'});
    } finally {
      this.setState({isFinalizingTransfer: false});
    }
  };

  onCreatePayload = async () => {
    const {selectedName, price, note, transferTo} = this.state;
    const domain = this.getSelectedDomain();

    if (!domain || !this.isTransferMature(domain)) {
      this.setState({sellerError: 'This transfer is not ready to finalize yet.'});
      return;
    }

    if (!transferTo) {
      this.setState({sellerError: 'Bob could not resolve the transfer recipient.'});
      return;
    }

    if (!price) {
      this.setState({sellerError: 'Enter the agreed HNS price.'});
      return;
    }

    this.setState({
      isCreatingPayload: true,
      sellerError: '',
      sellerNotice: '',
      payloadText: '',
    });

    try {
      const sellerPaymentAddress = (await walletClient.generateReceivingAddress()).address;
      const txHex = await this.props.finalizeWithPayment(
        selectedName,
        sellerPaymentAddress,
        transferTo,
        price,
      );

      if (!txHex) {
        throw new Error('Bob could not fully sign the paid finalize payload.');
      }

      const details = inspectPaidNameTransfer(txHex, this.props.network);
      if (details.errors.length) {
        throw new Error(details.errors.join(' '));
      }

      const payload = buildPaidNameTransferPayload({
        txHex,
        network: this.props.network,
        name: details.name,
        buyerAddress: details.nameReceiveAddr,
        sellerPaymentAddress: details.fundingAddr,
        price: details.price,
        transferTxHash: domain.owner && domain.owner.hash,
        note,
      });
      const payloadText = stringifyPaidNameTransferPayload(payload);

      this.saveHistory({
        type: 'payload-created',
        name: selectedName,
        buyerAddress: details.nameReceiveAddr,
        sellerPaymentAddress: details.fundingAddr,
        price,
        note,
      });
      this.setState({
        payloadText,
        sellerNotice: 'Claim payload created. Send it to the buyer.',
      });
    } catch (e) {
      this.setState({sellerError: e.message || 'Could not create claim payload.'});
    } finally {
      this.setState({isCreatingPayload: false});
    }
  };

  downloadPayload = () => {
    const {payloadText, selectedName} = this.state;
    if (!payloadText) {
      return;
    }

    const blob = new Blob([`${payloadText}\r\n`], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${selectedName || 'name'}-claim-payload.json`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(this.state.payloadText);
      this.setState({sellerNotice: 'Claim payload copied.'});
    } catch (e) {
      this.setState({sellerError: 'Could not copy payload.'});
    }
  };

  onSelectClaimFile = async () => {
    try {
      const {
        filePaths: [filepath],
      } = await dialog.showOpenDialog({
        title: 'Open claim payload',
        properties: ['openFile'],
        filters: [{name: 'JSON', extensions: ['json']}],
      });

      if (!filepath) return;
      const fileContent = fs.readFileSync(filepath, 'utf-8');
      this.setState({claimText: fileContent}, this.verifyClaimPayload);
    } catch (e) {
      this.setState({claimError: e.message || 'Could not load payload file.'});
    }
  };

  verifyClaimPayload = async () => {
    try {
      const parsed = parsePaidNameTransferInput(this.state.claimText);
      const details = inspectPaidNameTransfer(parsed.txHex, this.props.network);
      const errors = [...details.errors];
      const warnings = [...details.warnings];

      if (parsed.payload && parsed.payload.network && parsed.payload.network !== this.props.network) {
        errors.push(`Payload is for ${parsed.payload.network}, but Bob is on ${this.props.network}.`);
      }

      if (parsed.payload && parsed.payload.type && parsed.payload.type !== 'bob-paid-name-transfer') {
        warnings.push('Payload type is not Bob paid name transfer.');
      }

      const claimIsOwnAddress = details.nameReceiveAddr
        ? await this.props.hasAddress(details.nameReceiveAddr)
        : false;

      if (!claimIsOwnAddress) {
        warnings.push('The domain receiving address is not in this wallet.');
      }

      this.setState({
        claimDetails: {
          ...details,
          txHex: parsed.txHex,
          payload: parsed.payload,
          errors,
          warnings,
        },
        claimIsOwnAddress,
        claimError: errors.length ? errors.join(' ') : '',
        claimNotice: errors.length ? '' : 'Payload verified. Review every field before paying.',
      });
    } catch (e) {
      this.setState({
        claimDetails: null,
        claimError: e.message || 'Invalid claim payload.',
        claimNotice: '',
      });
    }
  };

  payAndClaim = async () => {
    const {claimDetails} = this.state;
    if (!claimDetails || claimDetails.errors.length) {
      return;
    }

    this.setState({isClaiming: true, claimError: '', claimNotice: ''});

    try {
      const mtx = await this.props.claimPaidTransfer(claimDetails.txHex);
      const txHash = mtx && (mtx.hash || (mtx.toJSON && mtx.toJSON().hash));
      this.saveHistory({
        type: 'claim-paid',
        name: claimDetails.name,
        buyerAddress: claimDetails.nameReceiveAddr,
        sellerPaymentAddress: claimDetails.fundingAddr,
        price: claimDetails.priceHNS,
        txHash,
      });
      this.setState({
        claimNotice: txHash
          ? `Claim transaction accepted: ${txHash}`
          : 'Claim transaction accepted. Wait for confirmation.',
      });
    } catch (e) {
      this.setState({claimError: e.message || 'Could not pay and claim.'});
    } finally {
      this.setState({isClaiming: false});
    }
  };

  renderModeTabs() {
    const mode = this.props.mode || SELL_MODE;

    return (
      <div className="send-name__tabs">
        <button
          className={mode === SELL_MODE ? 'send-name__tab send-name__tab--active' : 'send-name__tab'}
          onClick={() => this.props.setMode(SELL_MODE)}
        >
          Send Name
        </button>
        <button
          className={mode === CLAIM_MODE ? 'send-name__tab send-name__tab--active' : 'send-name__tab'}
          onClick={() => this.props.setMode(CLAIM_MODE)}
        >
          Claim Name
        </button>
      </div>
    );
  }

  renderSeller() {
    const domainOptions = this.getDomainOptions();
    const domain = this.getSelectedDomain();
    const isPending = this.isTransferPending(domain);
    const isMature = this.isTransferMature(domain);
    const remaining = this.getRemainingBlocks(domain);
    const canStart = domain && !domain.transfer && this.state.buyerAddress;
    const canCreate = domain && isMature && this.state.price && this.state.transferTo;

    return (
      <div className="send-name__panel">
        {this.renderDomainPicker(domainOptions)}

        {domain && !domain.transfer && (
          <>
            <div className="send-name__field">
              <label>Buyer Receiving Address (required)</label>
              <AddressInput
                onAddress={({address}) => this.setState({
                  buyerAddress: address,
                  sellerError: '',
                })}
              />
            </div>
            {this.renderPriceAndNote()}
            <button
              className="send-name__primary"
              disabled={!canStart || this.state.isStartingTransfer}
              onClick={this.onStartTransfer}
            >
              {this.state.isStartingTransfer ? 'Starting Transfer...' : 'Start Transfer'}
            </button>
          </>
        )}

        {domain && isPending && (
          <div className="send-name__status">
            <strong>Transfer in progress</strong>
            <span>
              {this.state.price
                ? `Ready to create a paid claim payload in ${remaining} block(s).`
                : `Ready for you to finalize the transfer in ${remaining} block(s).`}
            </span>
          </div>
        )}

        {domain && isMature && (
          <>
            <div className="send-name__status">
              <strong>{this.state.price ? 'Ready to create claim payload' : 'Ready to finalize transfer'}</strong>
              <span>
                {this.state.resolvingTransferTo
                  ? 'Reading transfer recipient...'
                  : `Domain will finalize to ${this.state.transferTo || 'unknown recipient'}.`}
              </span>
            </div>
            {this.renderPriceAndNote()}
            {this.state.price ? (
              <button
                className="send-name__primary"
                disabled={!canCreate || this.state.isCreatingPayload}
                onClick={this.onCreatePayload}
              >
                {this.state.isCreatingPayload ? 'Creating Payload...' : 'Create Claim Payload'}
              </button>
            ) : (
              <>
                <div className="send-name__status">
                  <strong>No price set</strong>
                  <span>This is a normal name transfer. Finalize it here to complete the send.</span>
                </div>
                <button
                  className="send-name__primary"
                  disabled={!this.state.transferTo || this.state.isFinalizingTransfer}
                  onClick={this.onFinalizeTransfer}
                >
                  {this.state.isFinalizingTransfer ? 'Finalizing Transfer...' : 'Finalize Transfer'}
                </button>
              </>
            )}
          </>
        )}

        <Alert type="error" message={this.state.sellerError} />
        <Alert type="success" message={this.state.sellerNotice} />

        {this.state.payloadText && (
          <div className="send-name__payload">
            <label>Claim Payload</label>
            <textarea value={this.state.payloadText} readOnly rows={8} />
            <div className="send-name__actions">
              <button onClick={this.copyPayload}>Copy Payload</button>
              <button onClick={this.downloadPayload}>Download Claim File</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  renderDomainPicker(domainOptions) {
    const allDomainCount = Object.keys(this.props.names).length;
    const sortIndex = DOMAIN_SORTS.findIndex(({value}) => value === this.state.domainSort);

    return (
      <div className="send-name__field">
        <label>Domain (required)</label>
        <div className="send-name__domain-tools">
          <div className="send-name__domain-search">
            <input
              value={this.state.domainQuery}
              onChange={e => this.setState({domainQuery: e.target.value})}
              placeholder="Search domains"
            />
          </div>
          <Dropdown
            className="send-name__domain-sort"
            items={DOMAIN_SORTS}
            currentIndex={sortIndex === -1 ? 0 : sortIndex}
            onChange={domainSort => this.setState({domainSort})}
          />
        </div>
        <div className="send-name__domain-list">
          {domainOptions.map(name => (
            <button
              key={name}
              className={this.state.selectedName === name
                ? 'send-name__domain-option send-name__domain-option--active'
                : 'send-name__domain-option'}
              onClick={() => this.setState({
                selectedName: name,
                payloadText: '',
                sellerError: '',
                sellerNotice: '',
              })}
            >
              <span>{name}/</span>
            </button>
          ))}
        </div>
        {this.props.isFetching && <p>Loading domains...</p>}
        {!this.props.isFetching && !allDomainCount && <p>No owned domains found.</p>}
        {!!allDomainCount && !domainOptions.length && <p>No domains match this search.</p>}
      </div>
    );
  }

  renderPriceAndNote() {
    return (
      <>
        <div className="send-name__field">
          <label>Price (optional)</label>
          <div className="send-name__amount-input">
            <input
              type="number"
              min={0}
              placeholder="0.000000"
              value={this.state.price}
              onChange={e => this.processPrice(e.target.value)}
            />
            <span>HNS</span>
          </div>
          <p className="send-name__hint">
            Leave blank for a normal name transfer. Add a price only when the buyer should pay to claim.
          </p>
        </div>
        <div className="send-name__field">
          <label>Note (optional, not on-chain)</label>
          <input
            value={this.state.note}
            onChange={e => this.setState({note: e.target.value})}
            placeholder="Optional note saved in this payload only"
          />
          <p className="send-name__hint">
            Saved in Bob history and the exported claim file only. Not written on-chain.
          </p>
        </div>
      </>
    );
  }

  renderClaim() {
    const {claimDetails} = this.state;

    return (
      <div className="send-name__panel">
        <div className="send-name__field">
          <label>Claim Payload</label>
          <textarea
            value={this.state.claimText}
            rows={8}
            onChange={e => this.setState({
              claimText: e.target.value,
              claimDetails: null,
              claimError: '',
              claimNotice: '',
            })}
            placeholder="Paste claim payload or raw transaction hex"
          />
        </div>
        <div className="send-name__actions">
          <button onClick={this.verifyClaimPayload} disabled={!this.state.claimText}>
            Verify
          </button>
          <button onClick={this.onSelectClaimFile}>
            Load File
          </button>
        </div>

        <Alert type="error" message={this.state.claimError} />
        <Alert type="success" message={this.state.claimNotice} />

        {claimDetails && (
          <div className="send-name__verify">
            <dl>
              <dt>Domain</dt>
              <dd>{claimDetails.name}/</dd>
              <dt>Address Receiving Name</dt>
              <dd>{claimDetails.nameReceiveAddr}</dd>
              <dt>Address In This Wallet</dt>
              <dd>{this.state.claimIsOwnAddress ? 'Yes' : 'No'}</dd>
              <dt>Seller Payment Address</dt>
              <dd>{claimDetails.fundingAddr}</dd>
              <dt>Price</dt>
              <dd>{claimDetails.priceHNS} HNS</dd>
            </dl>
            {!!claimDetails.warnings.length && (
              <div className="send-name__warnings">
                {claimDetails.warnings.map(warning => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
            <button
              className="send-name__primary"
              disabled={!!claimDetails.errors.length || this.state.isClaiming}
              onClick={this.payAndClaim}
            >
              {this.state.isClaiming ? 'Paying...' : 'Pay and Claim'}
            </button>
          </div>
        )}
      </div>
    );
  }

  renderHistory() {
    if (!this.state.history.length) {
      return null;
    }

    return (
      <div className="send-name__history">
        <h3>Recent Send Name Activity</h3>
        {this.state.history.slice(0, 5).map((item, idx) => (
          <div className="send-name__history-row" key={`${item.createdAt}-${idx}`}>
            <strong>{item.name}/</strong>
            <span>
              {item.type.replace(/-/g, ' ')}
              {item.txHash ? `: ${item.txHash}` : ''}
            </span>
            <small>{new Date(item.createdAt).toLocaleString()}</small>
          </div>
        ))}
      </div>
    );
  }

  render() {
    const mode = this.props.mode || SELL_MODE;

    return (
      <>
        <div className="send-name">
          {this.renderModeTabs()}
          {mode === SELL_MODE && (
            <div className="send-name__bulk-shortcut">
              <span>Sending several names to the same address?</span>
              <button onClick={() => this.setState({isShowingBulkTransfer: true})}>
                Bulk Transfer Names
              </button>
            </div>
          )}
          {mode === CLAIM_MODE ? this.renderClaim() : this.renderSeller()}
          {this.renderHistory()}
        </div>
        {this.state.isShowingBulkTransfer && (
          <BulkTransfer
            onClose={() => this.setState({isShowingBulkTransfer: false})}
          />
        )}
      </>
    );
  }
}

export default connect(
  state => ({
    names: state.myDomains.names,
    isFetching: state.myDomains.isFetching,
    height: state.node.chain.height,
    network: state.wallet.network,
    walletId: state.wallet.wid,
  }),
  dispatch => ({
    getMyNames: () => dispatch(getMyNames()),
    sendTransfer: (name, recipient) => dispatch(sendTransfer(name, recipient)),
    finalizeTransfer: (name) => dispatch(finalizeTransfer(name)),
    finalizeWithPayment: (name, fundingAddr, recipient, price) => dispatch(finalizeWithPayment(name, fundingAddr, recipient, price)),
    claimPaidTransfer: (hex) => dispatch(claimPaidTransfer(hex)),
    hasAddress: (address) => dispatch(hasAddress(address)),
  }),
)(SendName);

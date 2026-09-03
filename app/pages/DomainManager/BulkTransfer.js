import React, { Component } from 'react';
import PropTypes from "prop-types";
import { MiniModal } from '../../components/Modal/MiniModal';
import { connect } from 'react-redux';
import {showError, showSuccess} from '../../ducks/notifications';
import { waitForPassphrase, hasAddress } from '../../ducks/walletActions';
import isValidAddress from "../../utils/verifyAddress";
import Alert from "../../components/Alert";
import {transferMany} from "../../ducks/names";
import {I18nContext} from "../../utils/i18n";
import {consensus} from "hsd/lib/protocol";
import './bulk-transfer.scss';

const ITEMS_PER_PAGE = 10;
const MAX_NAMES_PER_TRANSACTION = consensus.MAX_BLOCK_UPDATES / 6;

@connect(
  (state) => ({
    network: state.wallet.network,
    names: state.myDomains.names,
  }),
  (dispatch) => ({
    showSuccess: (message) => dispatch(showSuccess(message)),
    showError: (message) => dispatch(showError(message)),
    waitForPassphrase: () => dispatch(waitForPassphrase()),
    hasAddress: (address) => dispatch(hasAddress(address)),
    transferMany: (names, address) => dispatch(transferMany(names, address)),
  }),
)
export default class BulkTransfer extends Component {
  static propTypes = {
    onClose: PropTypes.func.isRequired,
    names: PropTypes.object.isRequired,
  };

  static contextType = I18nContext;

  constructor(props) {
    super(props);
    this.state = {
      selectedOptions: [],
      recipientAddress: '',
      errorMessage: '',
      query: '',
      currentPageIndex: 0,
      sortDirection: 'asc',
      isSubmitting: false,
    };
  }

  getEligibleNames = () => {
    const query = this.state.query.trim().toLowerCase();

    return Object.keys(this.props.names)
      .filter(name => {
        const domain = this.props.names[name];
        return domain.registered
          && domain.transfer === 0
          && (!query || name.toLowerCase().includes(query));
      })
      .sort((a, b) => this.state.sortDirection === 'asc'
        ? a.localeCompare(b)
        : b.localeCompare(a));
  };

  toggleName = name => {
    const selected = new Set(this.state.selectedOptions);

    if (selected.has(name)) {
      selected.delete(name);
    } else if (selected.size >= MAX_NAMES_PER_TRANSACTION) {
      this.setState({
        errorMessage: `One transaction can contain up to ${MAX_NAMES_PER_TRANSACTION} name transfers.`,
      });
      return;
    } else {
      selected.add(name);
    }

    this.setState({
      selectedOptions: Array.from(selected),
      errorMessage: '',
    });
  };

  selectPage = pageNames => {
    const selected = new Set(this.state.selectedOptions);
    const remaining = MAX_NAMES_PER_TRANSACTION - selected.size;

    pageNames.filter(name => !selected.has(name)).slice(0, remaining).forEach(name => {
      selected.add(name);
    });

    this.setState({
      selectedOptions: Array.from(selected),
      errorMessage: '',
    });
  };

  updateToAddress = e => {
    this.setState({
      recipientAddress: e.target.value,
      errorMessage: '',
    });
    if (e.target.value.length > 2 && !isValidAddress(e.target.value, this.props.network)) {
      this.setState({
        errorMessage: this.context.t('invalidAddress'),
      });
    }
  };

  onTransfer = async () => {
    const { selectedOptions, recipientAddress } = this.state;
    this.setState({isSubmitting: true, errorMessage: ''});

    try {
      const res = await this.props.transferMany(selectedOptions, recipientAddress);

      if (res === null) {
        this.setState({
          isSubmitting: false,
          errorMessage: 'The transaction was not fully signed or sent. No transfer was submitted.',
        });
        return;
      }

      this.props.showSuccess(this.context.t('bulkTransferSuccess'));
      this.props.onClose();
    } catch (e) {
      this.setState({
        isSubmitting: false,
        errorMessage: e.message,
      });
    }
  };

  render() {
    const { t } = this.context;
    const eligibleNames = this.getEligibleNames();
    const pageCount = Math.max(1, Math.ceil(eligibleNames.length / ITEMS_PER_PAGE));
    const currentPageIndex = Math.min(this.state.currentPageIndex, pageCount - 1);
    const pageStart = currentPageIndex * ITEMS_PER_PAGE;
    const pageNames = eligibleNames.slice(pageStart, pageStart + ITEMS_PER_PAGE);
    const selected = new Set(this.state.selectedOptions);
    const pageIsSelected = pageNames.length > 0 && pageNames.every(name => selected.has(name));
    const addressIsValid = isValidAddress(this.state.recipientAddress, this.props.network);

    return (
      <MiniModal
        title={t('bulkTransfer')}
        onClose={this.props.onClose}
        wide
      >
        <div className="bulk-transfer">
          <Alert type="error" message={this.state.errorMessage} />
          <p>
            {t('bulkTransferLabel')}
          </p>
          <div className="bulk-transfer">
            <div className="bulk-transfer__label">{t('transferringTo')}</div>
            <div className="bulk-transfer__input">
              <input
                type="text"
                placeholder={t('recipientAddress')}
                onChange={this.updateToAddress}
                value={this.state.recipientAddress}
              />
            </div>
          </div>
          <div className="bulk-transfer__tools">
            <div className="bulk-transfer__search">
              <input
                type="search"
                aria-label="Search eligible names"
                placeholder="Type a name to filter"
                value={this.state.query}
                onChange={e => this.setState({
                  query: e.target.value,
                  currentPageIndex: 0,
                })}
              />
            </div>
            <select
              className="bulk-transfer__sort"
              aria-label="Sort names"
              value={this.state.sortDirection}
              onChange={e => this.setState({
                sortDirection: e.target.value,
                currentPageIndex: 0,
              })}
            >
              <option value="asc">Name A–Z</option>
              <option value="desc">Name Z–A</option>
            </select>
          </div>
          <div className="bulk-transfer__selection-summary">
            <strong>{selected.size} selected</strong>
            <span>Maximum {MAX_NAMES_PER_TRANSACTION} names per transaction</span>
          </div>
          <div className="bulk-transfer__page-actions">
            <button
              type="button"
              disabled={!pageNames.length || pageIsSelected || selected.size >= MAX_NAMES_PER_TRANSACTION}
              onClick={() => this.selectPage(pageNames)}
            >
              Select this page
            </button>
            <button
              type="button"
              disabled={!selected.size}
              onClick={() => this.setState({selectedOptions: [], errorMessage: ''})}
            >
              Clear selection
            </button>
          </div>
          <div className="bulk-transfer__name-list">
            {pageNames.map(name => (
              <label key={name} className="bulk-transfer__name-option">
                <input
                  type="checkbox"
                  checked={selected.has(name)}
                  onChange={() => this.toggleName(name)}
                />
                <span>{name}/</span>
              </label>
            ))}
            {!pageNames.length && (
              <p>No eligible names match this search.</p>
            )}
          </div>
          <div className="bulk-transfer__pagination">
            <button
              type="button"
              disabled={currentPageIndex === 0}
              onClick={() => this.setState({currentPageIndex: currentPageIndex - 1})}
            >
              Previous
            </button>
            <span>Page {currentPageIndex + 1} of {pageCount}</span>
            <button
              type="button"
              disabled={currentPageIndex >= pageCount - 1}
              onClick={() => this.setState({currentPageIndex: currentPageIndex + 1})}
            >
              Next
            </button>
          </div>
          <div className="bulk-transfer__actions">
            <button
              disabled={!selected.size || !addressIsValid || this.state.isSubmitting}
              onClick={this.onTransfer}
            >
              {this.state.isSubmitting
                ? `Submitting ${selected.size} name transfer${selected.size === 1 ? '' : 's'}...`
                : `${t('startTransfer')} (${selected.size})`}
            </button>
          </div>
        </div>
      </MiniModal>
    );
  }
}

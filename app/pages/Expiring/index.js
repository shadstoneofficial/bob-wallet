import React, {Component} from 'react';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import PropTypes from 'prop-types';
import moment from 'moment';
import * as networks from 'hsd/lib/protocol/networks';
import * as myDomainsActions from '../../ducks/myDomains';
import {formatName} from '../../utils/nameHelpers';
import {HeaderItem, HeaderRow, Table, TableItem, TableRow} from '../../components/Table';
import Blocktime from '../../components/Blocktime';
import DocsHelp from '../../components/DocsHelp';
import {I18nContext} from '../../utils/i18n';
import {DEFAULT_SHAKEDEX_CHANNEL_HOST} from '../../constants/shakedexChannels';
import {clientStub as sClientStub} from '../../background/shakedex/client';
import './expiring.scss';

const shakedex = sClientStub(() => require('electron').ipcRenderer);
const AVERAGE_BLOCK_TIME = 10 * 60 * 1000;
const SOON_BLOCKS = 30 * 24 * 6;

class Expiring extends Component {
  static propTypes = {
    getMyNames: PropTypes.func.isRequired,
    height: PropTypes.number,
    history: PropTypes.object.isRequired,
    isFetching: PropTypes.bool.isRequired,
    names: PropTypes.object.isRequired,
    namesList: PropTypes.array.isRequired,
    network: PropTypes.string.isRequired,
    spv: PropTypes.bool.isRequired,
  };

  static contextType = I18nContext;

  state = {
    channelExpiringNames: [],
    channelExpiringError: '',
    channelExpiringLoading: false,
    channelExpiringScope: '',
    channelExpiringCheckedAt: null,
    channelHost: DEFAULT_SHAKEDEX_CHANNEL_HOST,
  };

  componentDidMount() {
    this.props.getMyNames();
    this.fetchChannelExpiringNames();
  }

  componentWillUnmount() {
    this.unmounted = true;
  }

  async fetchChannelExpiringNames() {
    this.setState({
      channelExpiringLoading: true,
      channelExpiringError: '',
    });

    try {
      const data = await shakedex.getChannelExpiringNames(100);

      if (this.unmounted) {
        return;
      }

      this.setState({
        channelHost: data.host || DEFAULT_SHAKEDEX_CHANNEL_HOST,
        channelExpiringNames: data.names || [],
        channelExpiringScope: data.scope || 'channel-observed',
        channelExpiringCheckedAt: Date.now(),
        channelExpiringLoading: false,
        channelExpiringError: data.error || '',
      });
    } catch (e) {
      if (this.unmounted) {
        return;
      }

      this.setState({
        channelExpiringError: e.message || 'Could not load channel expiring names.',
        channelExpiringLoading: false,
      });
    }
  }

  renderEmptyRow(message) {
    return (
      <TableRow className="table__empty-row">
        <TableItem className="expiring-page__empty" grow={1}>
          {message}
        </TableItem>
      </TableRow>
    );
  }

  getExpirationHeight(name) {
    const domain = this.props.names[name];
    const network = networks[this.props.network];

    if (!domain?.renewal || !network?.names?.renewalWindow) {
      return Number.MAX_SAFE_INTEGER;
    }

    return domain.renewal + network.names.renewalWindow;
  }

  getExpirationRows() {
    return this.props.namesList
      .map(name => {
        const expirationHeight = this.getExpirationHeight(name);
        const blocksRemaining = expirationHeight - this.props.height;

        return {
          name,
          expirationHeight,
          blocksRemaining,
        };
      })
      .filter(row => row.expirationHeight !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        const expirationCompare = a.expirationHeight - b.expirationHeight;
        if (expirationCompare !== 0) {
          return expirationCompare;
        }
        return a.name.localeCompare(b.name);
      });
  }

  getStatus(blocksRemaining) {
    const {t} = this.context;

    if (blocksRemaining <= 0) {
      return {
        className: 'expiring-page__status--expired',
        label: t('expirationStatusExpired'),
      };
    }

    if (blocksRemaining <= SOON_BLOCKS) {
      return {
        className: 'expiring-page__status--soon',
        label: t('expirationStatusSoon'),
      };
    }

    return {
      className: 'expiring-page__status--later',
      label: t('expirationStatusLater'),
    };
  }

  renderRows(rows) {
    const {height, history} = this.props;
    const {t} = this.context;

    if (!rows.length) {
      return this.renderEmptyRow(t('expiringEmpty'));
    }

    return rows.map(({name, expirationHeight, blocksRemaining}) => {
      const status = this.getStatus(blocksRemaining);
      const estimatedDate = height && expirationHeight
        ? moment().add(blocksRemaining * AVERAGE_BLOCK_TIME).format('YYYY-MM-DD')
        : '';

      return (
        <TableRow
          key={name}
          onClick={() => history.push(`/domain_manager/${name}`)}
        >
          <TableItem>{formatName(name)}</TableItem>
          <TableItem>
            <Blocktime height={expirationHeight} format="ll" fromNow />
          </TableItem>
          <TableItem>{estimatedDate}</TableItem>
          <TableItem>{blocksRemaining}</TableItem>
          <TableItem>
            <span className={`expiring-page__status ${status.className}`}>
              {status.label}
            </span>
          </TableItem>
        </TableRow>
      );
    });
  }

  renderChannelRows() {
    const {
      channelExpiringNames,
      channelExpiringLoading,
      channelExpiringError,
    } = this.state;

    if (channelExpiringLoading) {
      return this.renderEmptyRow('Loading channel-observed names...');
    }

    if (channelExpiringError) {
      return this.renderEmptyRow(channelExpiringError);
    }

    const rows = channelExpiringNames
      .filter(row => row.found && row.blocksUntilExpire !== null && row.blocksUntilExpire !== undefined)
      .slice()
      .sort((a, b) => {
        const expirationCompare = a.blocksUntilExpire - b.blocksUntilExpire;
        if (expirationCompare !== 0) {
          return expirationCompare;
        }
        return a.name.localeCompare(b.name);
      });

    if (!rows.length) {
      return this.renderEmptyRow('No channel-observed expiring names yet.');
    }

    return rows.map(row => {
      const status = this.getStatus(row.blocksUntilExpire);
      const estimatedDate = typeof row.daysUntilExpire === 'number'
        ? moment().add(row.daysUntilExpire, 'days').format('YYYY-MM-DD')
        : moment().add(row.blocksUntilExpire * AVERAGE_BLOCK_TIME).format('YYYY-MM-DD');

      return (
        <TableRow key={row.name}>
          <TableItem>{formatName(row.name)}</TableItem>
          <TableItem>{row.expirationHeight || '-'}</TableItem>
          <TableItem>{estimatedDate}</TableItem>
          <TableItem>{row.blocksUntilExpire}</TableItem>
          <TableItem>
            <span className={`expiring-page__status ${status.className}`}>
              {status.label}
            </span>
          </TableItem>
        </TableRow>
      );
    });
  }

  render() {
    const rows = this.getExpirationRows();
    const {isFetching, spv} = this.props;
    const {t} = this.context;

    return (
      <div className="expiring-page">
        <div className="expiring-page__intro">
          <h2>{t('headingExpiring')}</h2>
          <p>{t('expiringIntro')}</p>
          <p className="expiring-page__mode-note">
            {spv ? t('expiringSpvNote') : t('expiringFullNodeNote')}
          </p>
        </div>
        <DocsHelp
          title="Expiring Names"
          href="https://bobwallet.org/docs/expiring-names"
        >
          This view focuses on names in your wallet. Global expiring discovery needs full-node or indexed Shakedex channel support.
        </DocsHelp>
        <div className="expiring-page__section-header">
          <div>
            <h3>Your Wallet Names</h3>
            <p>Names Bob sees in this wallet, using your local wallet and chain state.</p>
          </div>
        </div>
        <Table className="expiring-page__table">
          <HeaderRow>
            <HeaderItem>{t('domain')}</HeaderItem>
            <HeaderItem>{t('expiresOn')}</HeaderItem>
            <HeaderItem>{t('estimatedExpirationDate')}</HeaderItem>
            <HeaderItem>{t('blocksRemaining')}</HeaderItem>
            <HeaderItem>{t('expirationStatus')}</HeaderItem>
          </HeaderRow>
          {isFetching ? (
            this.renderEmptyRow(t('loadingNDomains', rows.length))
          ) : this.renderRows(rows)}
        </Table>
        <div className="expiring-page__section-header expiring-page__section-header--spaced">
          <div>
            <h3>Channel-Observed Names</h3>
            <p>
              Names observed by {this.state.channelHost}. This is not the full global expiry list yet.
            </p>
            {this.state.channelExpiringCheckedAt && (
              <p className="expiring-page__checked-at">
                Checked {moment(this.state.channelExpiringCheckedAt).format('HH:mm:ss')} · {this.state.channelExpiringScope}
              </p>
            )}
          </div>
          <button
            className="expiring-page__refresh"
            disabled={this.state.channelExpiringLoading}
            onClick={() => this.fetchChannelExpiringNames()}
          >
            Refresh
          </button>
        </div>
        <Table className="expiring-page__table">
          <HeaderRow>
            <HeaderItem>{t('domain')}</HeaderItem>
            <HeaderItem>{t('expiresOn')}</HeaderItem>
            <HeaderItem>{t('estimatedExpirationDate')}</HeaderItem>
            <HeaderItem>{t('blocksRemaining')}</HeaderItem>
            <HeaderItem>{t('expirationStatus')}</HeaderItem>
          </HeaderRow>
          {this.renderChannelRows()}
        </Table>
      </div>
    );
  }
}

export default withRouter(
  connect(
    state => ({
      names: state.myDomains.names,
      isFetching: state.myDomains.isFetching,
      namesList: Object.keys(state.myDomains.names),
      height: state.node.chain.height,
      network: state.wallet.network,
      spv: state.node.spv,
    }),
    dispatch => ({
      getMyNames: () => dispatch(myDomainsActions.getMyNames()),
    }),
  )(Expiring),
);

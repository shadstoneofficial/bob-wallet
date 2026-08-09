import { shell } from 'electron';
import React, { Component } from 'react';
import { withRouter, NavLink } from 'react-router-dom';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import './sidebar.scss';
import ellipsify from '../../utils/ellipsify';
import {I18nContext} from "../../utils/i18n";
import { Logo } from '../Logo';
import {clientStub} from "../../background/node/client";
import {NETWORKS} from "../../constants/networks";
const pkg = require('../../../package.json');
const nodeClient = clientStub(() => require('electron').ipcRenderer);

@withRouter
@connect(
  state => ({
    network: state.wallet.network,
    chainHeight: state.node.chain.height,
    tip: state.node.chain.tip,
    newBlockStatus: state.node.newBlockStatus,
    spv: state.node.spv,
    walletId: state.wallet.wid,
    walletsDetails: state.wallet.walletsDetails,
    walletInitialized: state.wallet.initialized,
    walletType: state.wallet.type,
    walletWatchOnly: state.wallet.watchOnly,
    walletSync: state.wallet.walletSync,
    walletHeight: state.wallet.walletHeight,
    rescanHeight: state.wallet.rescanHeight,
    address: state.wallet.receiveAddress,
    updateAvailable: state.app.updateAvailable,
  }),
  dispatch => ({
  }),
)
class Sidebar extends Component {
  static propTypes = {
    history: PropTypes.shape({
      push: PropTypes.func.isRequired
    }).isRequired,
    location: PropTypes.shape({
      pathname: PropTypes.string.isRequired
    }).isRequired,
    chainHeight: PropTypes.number.isRequired,
    walletId: PropTypes.string.isRequired,
    walletsDetails: PropTypes.object.isRequired,
    walletInitialized: PropTypes.bool.isRequired,
    walletType: PropTypes.string.isRequired,
    tip: PropTypes.string.isRequired,
    newBlockStatus: PropTypes.string.isRequired,
    spv: PropTypes.bool.isRequired,
    walletWatchOnly: PropTypes.bool.isRequired,
    walletSync: PropTypes.bool.isRequired,
    walletHeight: PropTypes.number.isRequired,
    rescanHeight: PropTypes.number,
    network: PropTypes.string.isRequired,
    address: PropTypes.string,
    updateAvailable: PropTypes.object,
  };

  static contextType = I18nContext;

  render() {
    return (
      <div className="sidebar">
        <div className="sidebar__content">
          <div className="sidebar__logo-wrapper">
            <Logo />
          </div>
          {this.renderNav()}
        </div>
        {this.renderFooter()}
      </div>
    );
  }

  renderNav() {
    const {t} = this.context;
    const {walletId, walletType, walletInitialized, walletsDetails} = this.props;

    const name = walletsDetails[walletId]?.displayName || walletId;
    const title = `${t('settingWallet')}: ${name}`;

    if (!walletInitialized) {
      return(
        <React.Fragment>
          <div className="sidebar__section">{title}</div>
          <div className="sidebar__actions">
            <NavLink
              className="sidebar__action"
              to="/multisig"
              activeClassName="sidebar__action--selected"
            >
              ⚠️ {t('headingMultisigSetup')}
            </NavLink>
          </div>
      </React.Fragment>
      );
    }

    return (
      <React.Fragment>
        <div className="sidebar__section">{title}</div>
        <div className="sidebar__actions">
          {
            walletType === 'multisig' &&
            <NavLink
              className="sidebar__action"
              to="/multisig"
              activeClassName="sidebar__action--selected"
            >
              {t('headingMultisig')}
            </NavLink>
          }
          <NavLink
            to="/overview"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingOverview')}
          </NavLink>
          <NavLink
            to="/account"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingPortfolio')}
          </NavLink>
          <NavLink
            to="/send"
            isActive={(match, location) => (
              location.pathname === '/send'
              && !new URLSearchParams(location.search || '').get('asset')
            )}
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingSend')}
          </NavLink>
          <NavLink
            to="/receive"
            isActive={(match, location) => location.pathname === '/receive'}
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingReceive')}
          </NavLink>
          <NavLink
            to="/receive/addresses"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingAddresses')}
          </NavLink>

          <NavLink
            to="/domain_manager"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingDomainManager')}
          </NavLink>
        </div>
        <div className="sidebar__section">{t('headingAuctions')}</div>
        <div className="sidebar__actions">
          <NavLink
            to="/bids"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingYourBids')}
          </NavLink>
          <NavLink
            to="/auction-basket"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingAuctionBasket')}
          </NavLink>
          <NavLink
            to="/open-basket"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingOpenBasket')}
          </NavLink>
          <NavLink
            to="/watching"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingWatching')}
          </NavLink>
          <NavLink
            to="/expiring"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingExpiring')}
          </NavLink>
        </div>
        <div className="sidebar__section">{t('headingAddOns')}</div>
        <div className="sidebar__actions">
          <NavLink
            to="/exchange"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingShakedexMarketplace')}
          </NavLink>
          <NavLink
            to="/messages"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingMessages')}
          </NavLink>
          <NavLink
            to="/send?asset=name&mode=send"
            isActive={(match, location) => (
              location.pathname === '/send'
              && new URLSearchParams(location.search || '').get('asset') === 'name'
            )}
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            Send Name
          </NavLink>
          <NavLink
            to="/liquidity-swap"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            Liquidity Swap
          </NavLink>
          <NavLink
            to="/addons"
            className={isActive => `sidebar__action ${isActive ? "sidebar__action--selected" : ''}`}
          >
            {t('headingMoreAddons')}
          </NavLink>
        </div>
      </React.Fragment>
    );
  }

  renderGenerateBlockButton(numblocks) {
    const { network, address, spv } = this.props;
    if (spv || !address) {
      return;
    }

    if ([NETWORKS.SIMNET, NETWORKS.REGTEST].includes(network)) {
      return (
        <button
          className="sidebar__generate-btn"
          onClick={() => nodeClient.generateToAddress(numblocks, address)}
        >
         {`+${numblocks}`}
        </button>
      )
    }
  }

  renderFooter() {
    const {t} = this.context;

    const {
      walletSync,
      walletHeight,
      rescanHeight,
      newBlockStatus,
      chainHeight,
      tip,
      updateAvailable,
    } = this.props;

    return (
      <div className="sidebar__footer">
        <div className="sidebar__footer__version" title={`Bob LearnHNS ${pkg.version}`}>
          Bob LearnHNS v{pkg.version}
        </div>
        {updateAvailable ? (
          <div className="sidebar__footer__row">
            <button
              className="sidebar__footer__update-notif"
              onClick={() => shell.openExternal(updateAvailable.url)}
            >
              {t('updateAvailable')} ({updateAvailable.version})
            </button>
          </div>
        ) : null}
        {newBlockStatus ? (
          <div className="sidebar__footer__row">
            <div className="sidebar__footer__title">{newBlockStatus}</div>
          </div>)
          : null
        }
        <div className="sidebar__footer__row">
          <div className="sidebar__footer__title">{t('currentHeight')}</div>
          <div className="sidebar__footer__text">
            {walletSync ? `${walletHeight}/${rescanHeight}` : `${chainHeight}` || '--'}
          </div>
          <div className="sidebar__footer__simnet-controls">
            {this.renderGenerateBlockButton(1)}
            {this.renderGenerateBlockButton(10)}
            {this.renderGenerateBlockButton(50)}
          </div>
        </div>
        <div className="sidebar__footer__row">
          <div className="sidebar__footer__title">{t('currentHash')}</div>
          <div className="sidebar__footer__text">
            {tip ? ellipsify(tip) : '--'}
          </div>
        </div>
      </div>
    );
  }
}

export default Sidebar;

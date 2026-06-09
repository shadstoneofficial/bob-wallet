import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import {
  AuctionPanel,
  AuctionPanelFooter,
  AuctionPanelHeader,
  AuctionPanelHeaderRow
} from '../../../components/AuctionPanel';
import { displayBalance } from '../../../utils/balances';
import Blocktime from '../../../components/Blocktime';
import * as names from '../../../ducks/names';
import { showError, showSuccess } from '../../../ducks/notifications';
import * as logger from '../../../utils/logClient';
import { formatTxHash } from '../../../utils/txHash';
import {I18nContext} from "../../../utils/i18n";

class Owned extends Component {
  static propTypes = {
    domain: PropTypes.object.isRequired,
    chain: PropTypes.object.isRequired,
    name: PropTypes.string.isRequired,
    sendRenewal: PropTypes.func.isRequired,
    sendRegister: PropTypes.func.isRequired,
    showSuccess: PropTypes.func.isRequired,
    showError: PropTypes.func.isRequired,
    history: PropTypes.shape({
      push: PropTypes.func,
    }).isRequired,
  };

  static contextType = I18nContext;

  state = {
    isSubmittingRegister: false,
    isSubmittingRenewal: false,
  };

  sendRenewal = async () => {
    if (this.state.isSubmittingRenewal) {
      return;
    }

    this.setState({isSubmittingRenewal: true});

    try {
      const res = await this.props.sendRenewal();
      if (res !== null) {
        this.props.showSuccess(this.context.t('renewSuccess'));
      }
    } catch (e) {
      this.props.showError(e.message);
    } finally {
      this.setState({isSubmittingRenewal: false});
    }
  };

  sendRegister = async () => {
    if (this.state.isSubmittingRegister) {
      return;
    }

    this.setState({isSubmittingRegister: true});

    try {
      const res = await this.props.sendRegister();
      if (res !== null) {
        this.props.showSuccess(this.context.t('registerSuccess'));
        logger.info(`Auction register submitted for ${this.props.name}/: tx=${formatTxHash(res)}`);
      }
    } catch (e) {
      this.props.showError(e.message);
    } finally {
      this.setState({isSubmittingRegister: false});
    }
  };

  render() {
    const { domain, history, name, chain } = this.props;
    const { info, bids = [] } = domain || {};
    const { highest, stats } = info || {};
    const { renewalPeriodStart, renewalPeriodEnd } = stats || {};
    const isPendingRenew = domain.pendingOperation === 'RENEW';
    const isPendingRegister = domain.pendingOperation === 'REGISTER';
    const {isSubmittingRegister, isSubmittingRenewal} = this.state;
    const {t} = this.context;

    return (
      <AuctionPanel>
        <AuctionPanelHeader title={t('ownedTitle')}>
          <AuctionPanelHeaderRow label={t('expiresOn') + ':'}>
            <Blocktime
              height={renewalPeriodEnd}
              format="ll"
            />
          </AuctionPanelHeaderRow>
          <AuctionPanelHeaderRow label={t('totalBids') + ':'}>
            {bids.length}
          </AuctionPanelHeaderRow>
          <AuctionPanelHeaderRow label={t('highestBid') + ':'}>
            {displayBalance(highest, true)}
          </AuctionPanelHeaderRow>
        </AuctionPanelHeader>
        <AuctionPanelFooter className="domains__action-panel__owned-actions">
          { info.registered ?
            <button
              className="domains__action-panel__renew-domain-btn"
              onClick={this.sendRenewal}
              disabled={isSubmittingRenewal || isPendingRenew || !chain || chain.height < renewalPeriodStart}
            >
              { isSubmittingRenewal ? t('submitting') : (isPendingRenew ? t('renewing') : t('renewMyDomain')) }
            </button>
            :
            <button
              className="domains__action-panel__renew-domain-btn"
              onClick={this.sendRegister}
              disabled={isSubmittingRegister || isPendingRegister}
            >
              { isSubmittingRegister ? t('submitting') : (isPendingRegister ? t('registering') : t('registerMyDomain')) }
            </button>
          }
          <button
            className="domains__action-panel__manage-domain-btn"
            onClick={() => history.push(`/domain_manager/${name}`)}
          >
            {t('manageMyDomain')}
          </button>
        </AuctionPanelFooter>
      </AuctionPanel>
    );
  }
}

export default withRouter(
  connect(
    state => ({
      chain: state.node.chain,
    }),
    (dispatch, { name }) => ({
      sendRenewal: () => dispatch(names.sendRenewal(name)),
      sendRegister: () => dispatch(names.sendRegister(name)),
      showSuccess: (message) => dispatch(showSuccess(message)),
      showError: (message) => dispatch(showError(message)),
    })
  )(Owned)
);

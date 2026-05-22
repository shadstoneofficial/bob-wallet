import React, { Component } from 'react';
import MiniModal from '../../components/Modal/MiniModal.js';
import { displayBalance } from '../../utils/balances.js';
import { connect } from 'react-redux';
import './exchange.scss';
import { placeExchangeBid } from '../../ducks/exchange.js';
import Alert from "../../components/Alert";
import {I18nContext} from "../../utils/i18n";

export class PlaceBidModal extends Component {
  static contextType = I18nContext;

  componentDidUpdate(prevProps) {
    if (prevProps.isPlacingBid && !this.props.isPlacingBid && !this.props.isPlacingBidError) {
      this.props.onClose();
    }
  }

  render() {
    const {auction, bid, onClose, spendableBalance} = this.props;
    const {t} = this.context;
    const requiredBalance = bid.price + (bid.fee || 0);
    const hasEnoughBalance = spendableBalance >= requiredBalance;

    return (
      <MiniModal title={t('buyMarketplaceName')} onClose={() => {
        if (this.props.isPlacingBid) {
          return;
        }
        onClose();
      }}>
        <div className="exchange__place-listing-modal">
          {this.props.isPlacingBidError && (
            <Alert
              className="place-bid-modal__alert"
              type="error"
              message={this.props.placingBidErrorMessage || t('shakedexPlaceBidError')}
            />
          )}
          <p>
            {t('marketplaceBuyWarning')}
          </p>
          {this.props.isPrivateProof && (
            <Alert
              className="place-bid-modal__alert"
              type="warning"
              message={t('privateSaleBuyerWarning')}
            />
          )}
          {!hasEnoughBalance && (
            <Alert
              className="place-bid-modal__alert"
              type="warning"
              message={t('marketplaceInsufficientBalance')}
            />
          )}
          <table className="place-bid-modal__table">
            <tbody>
              <tr>
                <td><strong>{`${t('domain')}:`}</strong></td>
                <td>{auction.name}</td>
              </tr>
              <tr>
                <td><strong>{`${t('price')}:`}</strong></td>
                <td>{displayBalance(bid.price, true)}</td>
              </tr>
              {!!bid.fee && (
                <tr>
                  <td><strong>{`${t('marketplaceFee')}:`}</strong></td>
                  <td>{displayBalance(bid.fee, true)}</td>
                </tr>
              )}
              <tr>
                <td><strong>{`${t('total')}:`}</strong></td>
                <td>{displayBalance(requiredBalance, true)}</td>
              </tr>
              <tr>
                <td><strong>{`${t('spendable')}:`}</strong></td>
                <td>{displayBalance(spendableBalance, true)}</td>
              </tr>
            </tbody>
          </table>

          <div className="place-bid-modal__buttons">
            <button
              className="place-bid-modal__cancel"
              onClick={onClose}
              disabled={this.props.isPlacingBid}
            >
              {t('cancel')}
            </button>

            <button
              className="place-bid-modal__send"
              onClick={() => this.props.placeExchangeBid(auction, bid)}
              disabled={this.props.isPlacingBid || !hasEnoughBalance}
            >
              {this.props.isPlacingBid ? t('loading') : t('confirmBuy')}
            </button>
          </div>
        </div>
      </MiniModal>
    );
  }
}

export default connect(
  (state) => ({
    isPlacingBid: state.exchange.isPlacingBid,
    isPlacingBidError: state.exchange.isPlacingBidError,
    placingBidErrorMessage: state.exchange.placingBidErrorMessage,
    spendableBalance: state.wallet.balance.spendable,
  }),
  (dispatch) => ({
    placeExchangeBid: (auction, bid) => dispatch(placeExchangeBid(auction, bid)),
  }),
)(PlaceBidModal);

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import MiniModal from '../../components/Modal/MiniModal.js';
import { connect } from 'react-redux';
import Dropdown from '../../components/Dropdown';
import Alert from "../../components/Alert";
import {launchExchangeAuction} from "../../ducks/exchange";
import {formatName} from "../../utils/nameHelpers";
import {I18nContext} from "../../utils/i18n";

const REVERSE_DURATION_OPTS = [1, 3, 5, 7, 14];
const FIXED_DURATION_OPTS = [30, 90, 180, 365];
const DEFAULT_FIXED_DURATION_DAYS = 365;
const DEFAULT_REVERSE_DURATION_DAYS = 7;

export class GenerateListingModal extends Component {
  static propTypes = {
    listing: PropTypes.object.isRequired,
  };

  static contextType = I18nContext;

  constructor(props) {
    super(props);

    const listingMode = props.listing.params.mode || 'reverse';
    const durationOpts = listingMode === 'fixed'
      ? FIXED_DURATION_OPTS
      : REVERSE_DURATION_OPTS;
    const defaultDurationDays = listingMode === 'fixed'
      ? DEFAULT_FIXED_DURATION_DAYS
      : DEFAULT_REVERSE_DURATION_DAYS;
    const existingDurationDays = Number(props.listing.params.durationDays);
    const durationDays = listingMode === 'fixed' && existingDurationDays < DEFAULT_FIXED_DURATION_DAYS
      ? DEFAULT_FIXED_DURATION_DAYS
      : existingDurationDays;
    const durationIdx = durationOpts.indexOf(durationDays);

    this.state = {
      listingMode,
      price: Number(props.listing.params.price || 0) / 1e6 || '',
      startPrice: Number(props.listing.params.startPrice) / 1e6,
      endPrice: Number(props.listing.params.endPrice) / 1e6,
      durationIdx: durationIdx >= 0 ? durationIdx : durationOpts.indexOf(defaultDurationDays),
      errorMessage: '',
      isGenerating: false,
    };
  }

  getDurationOpts() {
    return this.state.listingMode === 'fixed'
      ? FIXED_DURATION_OPTS
      : REVERSE_DURATION_OPTS;
  }

  generateProofs = async (submitAfterGenerate = false) => {
    this.setState({
      errorMessage: '',
      isGenerating: true,
    });

    try {
      const { launchExchangeAuction, listing } = this.props;
      const { listingMode, price, startPrice, endPrice, durationIdx } = this.state;
      const durationDays = this.getDurationOpts()[durationIdx];

      const overrideParams = listingMode === 'fixed'
        ? { mode: 'fixed', price: Math.round(price * 1e6), durationDays }
        : {
          mode: 'reverse',
          startPrice: Math.round(startPrice * 1e6),
          endPrice: Math.round(endPrice * 1e6),
          durationDays,
        };
      if (listing.lowestDeprecatedPrice) {
        overrideParams.lowestDeprecatedPrice = listing.lowestDeprecatedPrice;
      }
      const updatedListings = await launchExchangeAuction(listing.nameLock, overrideParams);
      const generatedListing = Array.isArray(updatedListings)
        ? updatedListings.find(updatedListing => (
          updatedListing
          && updatedListing.nameLock
          && updatedListing.nameLock.name === listing.nameLock.name
        ))
        : null;

      if (this.props.onProofGenerated) {
        await this.props.onProofGenerated(listing.nameLock.name, {
          generatedListing,
          submitAfterGenerate,
        });
      }
      this.props.onClose();
    } catch (e) {
      this.setState({
        errorMessage: e.message,
        isGenerating: false,
      });
    }

  };

  render() {
    const {onClose, listing, canSubmitAfterGenerate} = this.props;
    const {t} = this.context;

    const isFixed = this.state.listingMode === 'fixed';
    const isValid = isFixed
      ? String(this.state.price).length && Number(this.state.price) > 0
      : String(this.state.startPrice).length &&
        String(this.state.endPrice).length &&
        Number(this.state.startPrice) > 0 &&
        Number(this.state.endPrice) > 0 &&
        Number(this.state.startPrice) > Number(this.state.endPrice);

    return (
      <MiniModal title={t('generateListingProof')} onClose={onClose}>
        <div className="exchange__place-listing-modal">
          {listing.lowestDeprecatedPrice &&
            <Alert type="warning">
              Anyone with the old bids will still be able to buy this name
              at <strong>{listing.lowestDeprecatedPrice/1e6} HNS</strong>!<br />
              Cancel the listing if you do not want this.
            </Alert>
          }
          <div className="exchange__label">{`${t('listingName')}:`}</div>
          <div className="exchange__input">
            {formatName(listing.nameLock.name)}
          </div>

          <Alert type="info">
            {t('generateListingProofInfo')}
          </Alert>

          <label className="exchange__label">{`${t('listingType')}:`}</label>
          <Dropdown
            items={[
              { label: t('buyNow') },
              { label: t('reverseAuction') },
            ]}
            onChange={(i) => this.setState({
              listingMode: i === 0 ? 'fixed' : 'reverse',
              durationIdx: i === 0
                ? FIXED_DURATION_OPTS.indexOf(DEFAULT_FIXED_DURATION_DAYS)
                : REVERSE_DURATION_OPTS.indexOf(DEFAULT_REVERSE_DURATION_DAYS),
              errorMessage: '',
            })}
            currentIndex={isFixed ? 0 : 1}
          />

          {isFixed ? (
            <>
              <label className="exchange__label">{`${t('buyNowPrice')}:`}</label>
              <div className="exchange__field-help">
                {t('generateListingProofPriceHelp')}
              </div>
              <div className="exchange__input send__input">
                <input
                  type="number"
                  value={this.state.price}
                  onChange={(e) => this.setState({
                    price: e.target.value,
                    errorMessage: '',
                  })}
                />
              </div>
              <label className="exchange__label">{`${t('duration')}:`}</label>
              <Dropdown
                items={this.getDurationOpts().map(d => ({
                  label: `${d} ${t('days')}`,
                }))}
                onChange={(i) => this.setState({
                  durationIdx: i,
                  errorMessage: '',
                })}
                currentIndex={this.state.durationIdx}
              />
            </>
          ) : (
            <>
              <label className="exchange__label">{`${t('startingPrice')}:`}</label>
              <div className="exchange__input send__input">
                <input
                  type="number"
                  value={this.state.startPrice}
                  onChange={(e) => this.setState({
                    startPrice: e.target.value,
                    errorMessage: '',
                  })}
                />
              </div>

              <label className="exchange__label">{`${t('endingPrice')}:`}</label>
              <div className="exchange__input send__input">
                <input
                  type="number"
                  value={this.state.endPrice}
                  onChange={(e) => this.setState({
                    endPrice: e.target.value,
                    errorMessage: '',
                  })}
                />
              </div>

              <label className="exchange__label">{`${t('duration')}:`}</label>
              <Dropdown
                items={this.getDurationOpts().map(d => ({
                  label: `${d} ${t('days')}`,
                }))}
                onChange={(i) => this.setState({
                  durationIdx: i,
                  errorMessage: '',
                })}
                currentIndex={this.state.durationIdx}
              />
            </>
          )}
          <Alert type="error" message={this.state.errorMessage} />
          <div className="place-bid-modal__buttons">
            <button
              className="place-bid-modal__cancel"
              onClick={onClose}
              disabled={this.state.isGenerating}
            >
              {t('cancel')}
            </button>
            {canSubmitAfterGenerate && (
              <button
                className="place-bid-modal__cancel"
                onClick={() => this.generateProofs(false)}
                disabled={!isValid || this.state.isGenerating}
              >
                {this.state.isGenerating ? t('generating') : t('generateProofs')}
              </button>
            )}
            <button
              className="place-bid-modal__send"
              onClick={() => this.generateProofs(canSubmitAfterGenerate)}
              disabled={!isValid || this.state.isGenerating}
            >
              {this.state.isGenerating
                ? t('generating')
                : canSubmitAfterGenerate ? t('generateAndSubmit') : t('generateProofs')}
            </button>
          </div>
        </div>
      </MiniModal>
    );
  }
}

export default connect(
  (state) => ({
  }),
  (dispatch) => ({
    launchExchangeAuction: (nameLock, overrideParams) => dispatch(launchExchangeAuction(nameLock, overrideParams)),
  }),
)(GenerateListingModal);

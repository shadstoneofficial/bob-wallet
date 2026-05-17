import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Anchor from '../../../components/Anchor';
import CopyButton from '../../../components/CopyButton';
import './access.scss';
import {I18nContext} from "../../../utils/i18n";

const MIGRATE_ORIGINAL_BOB_COMMAND = `SRC="$HOME/Library/Application Support/Bob"
DST="$HOME/Library/Application Support/Bob LearnHNS"
[ -d "$SRC" ] || { echo "Original Bob data not found: $SRC"; exit 1; }
[ -d "$DST" ] && ditto "$DST" "$DST backup $(date +%Y%m%d-%H%M%S)"
ditto "$SRC" "$DST"
echo "Copied Bob wallet data to Bob LearnHNS. Reopen Bob LearnHNS."`;

class FundAccessOptions extends Component {
  static propTypes = {
    history: PropTypes.shape({
      push: PropTypes.func
    }).isRequired
  };

  static contextType = I18nContext;

  render() {
    const {t} = this.context;
    return (
      <div className="extension_primary_section funding-options">
        <div className="funding-options__header">
          <div className="funding-options__header__the-cat" />
        </div>
        <div className="funding-options__content">
          <div className="funding-options__content__title">
            {t('obMainTitle')}
          </div>
          <div className="funding-options__content__body-text">
            {t('obMainBody')}
          </div>
          <div className="funding-options__migration">
            <div className="funding-options__migration__title">
              {t('obMigrationTitle')}
            </div>
            <div className="funding-options__migration__body">
              {t('obMigrationBody')}
            </div>
            <pre className="funding-options__migration__command">
              {MIGRATE_ORIGINAL_BOB_COMMAND}
            </pre>
            <CopyButton
              className="funding-options__migration__copy"
              content={MIGRATE_ORIGINAL_BOB_COMMAND}
              btnText={t('obMigrationCopyCommand')}
            />
            <div className="funding-options__migration__link">
              <Anchor href="https://bobwallet.org/docs/migrate-to-bob-learnhns">
                {t('obMigrationReadGuide')}
              </Anchor>
            </div>
          </div>
        </div>
        <div className="funding-options__footer">
          <button
            type="button"
            className="funding-options__footer__primary-btn"
            onClick={() => this.props.history.push('/new-wallet/local')}
          >
            {t('obMainCreateText')}
          </button>
          <button
            type="button"
            className="funding-options__footer__secondary-btn"
            onClick={() => this.props.history.push('/existing-options')}
          >
            {t('obMainImportText')}
          </button>
          <button
            type="button"
            className="funding-options__footer__secondary-btn"
            onClick={() => this.props.history.push('/new-wallet/ledger')}
          >
            {t('obMainConnectLedger')}
          </button>

          {!!this.props.wallets.length && (
            <Link
              to="/"
              className="login_subheader_text login_subheader_text__accent"
            >
              {t('obMainReturnToLogin')}
            </Link>
          )}
        </div>
      </div>
    );
  }
}

export default withRouter(
  connect(
    state => ({
      wallets: state.wallet.wallets
    }),
    dispatch => ({})
  )(FundAccessOptions)
);

import React, {Component} from 'react';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';

import {clientStub as storageClientStub} from '../../background/storage/client';
import {I18nContext} from '../../utils/i18n';
import './storage-error-banner.scss';

const storageClient = storageClientStub(() => require('electron').ipcRenderer);

@connect(state => ({storage: state.storage}))
export default class StorageErrorBanner extends Component {
  static propTypes = {
    storage: PropTypes.shape({
      blocked: PropTypes.bool.isRequired,
      transactionAttempted: PropTypes.bool.isRequired,
      availableBytes: PropTypes.number,
      requiredBytes: PropTypes.number,
    }).isRequired,
  };

  static contextType = I18nContext;

  state = {
    checking: false,
    checkFailed: false,
  };

  retryStatusCheck = async () => {
    if (this.state.checking) return;

    this.setState({checking: true, checkFailed: false});
    try {
      const result = await storageClient.retryStatusCheck();
      this.setState({checkFailed: !result.ok});
    } catch (error) {
      console.error('[Bob storage] Status check failed', {
        code: error?.code || '',
        message: String(error?.message || error).slice(0, 500),
      });
      this.setState({checkFailed: true});
    } finally {
      this.setState({checking: false});
    }
  };

  render() {
    const {storage} = this.props;
    if (!storage.blocked) return null;

    const {t} = this.context;
    const {checking, checkFailed} = this.state;

    return (
      <section className="storage-error-banner" role="alert" aria-live="assertive">
        <div className="storage-error-banner__title">{t('storageErrorTitle')}</div>
        <div>{t('storageErrorPaused')}</div>
        {storage.transactionAttempted && (
          <div className="storage-error-banner__transaction">
            {t('storageErrorTransaction')}
          </div>
        )}
        <ol className="storage-error-banner__steps">
          <li>{t('storageErrorQuit')}</li>
          <li>{t('storageErrorFreeSpace')}</li>
          <li>{t('storageErrorDoNotDelete')}</li>
          <li>{t('storageErrorReopen')}</li>
        </ol>
        {checkFailed && (
          <div className="storage-error-banner__check-failed">
            {t('storageErrorStillLow')}
          </div>
        )}
        <button
          type="button"
          disabled={checking}
          onClick={this.retryStatusCheck}
          className="storage-error-banner__retry"
        >
          {checking ? t('storageErrorChecking') : t('storageErrorRetry')}
        </button>
      </section>
    );
  }
}

import React, {Component} from 'react';
import SignMessage from '../SignMessage';
import VerifyMessage from '../VerifyMessage';
import {I18nContext} from '../../utils/i18n';
import './messages.scss';

class Messages extends Component {
  static contextType = I18nContext;

  state = {
    mode: 'sign',
  };

  render() {
    const {t} = this.context;
    const {mode} = this.state;

    return (
      <div className="messages-page">
        <div className="messages-page__tabs">
          <button
            className={mode === 'sign' ? 'messages-page__tab messages-page__tab--active' : 'messages-page__tab'}
            onClick={() => this.setState({mode: 'sign'})}
          >
            {t('headingSignMessage')}
          </button>
          <button
            className={mode === 'verify' ? 'messages-page__tab messages-page__tab--active' : 'messages-page__tab'}
            onClick={() => this.setState({mode: 'verify'})}
          >
            {t('headingVerifyMessage')}
          </button>
        </div>
        <div className="messages-page__content">
          {mode === 'sign' ? <SignMessage /> : <VerifyMessage />}
        </div>
      </div>
    );
  }
}

export default Messages;

import React, {Component} from 'react';
import SignMessage from '../SignMessage';
import VerifyMessage from '../VerifyMessage';
import DocsHelp from '../../components/DocsHelp';
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
        <DocsHelp
          title="Messages"
          href="https://bobwallet.org/docs/messages"
        >
          Sign or verify a statement using ownership of a Handshake name. This proves identity without moving funds.
        </DocsHelp>
        <div className="messages-page__help">
          <div>
            <div className="messages-page__help-title">Safe examples</div>
            <p>I own example/ for this marketplace profile.</p>
            <p>I am verifying this support request on May 11, 2026.</p>
          </div>
          <div>
            <div className="messages-page__help-title">Before signing</div>
            <p>Only sign messages you understand. Message signing is offline, does not broadcast a transaction, and does not cost HNS.</p>
          </div>
        </div>
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

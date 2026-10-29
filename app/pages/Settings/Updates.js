import React from 'react';
import {makeClient} from '../../background/ipc/ipc';
import {I18nContext} from '../../utils/i18n';
import Anchor from '../../components/Anchor';

const inject = () => require('electron').ipcRenderer;
const status = makeClient(inject, 'Updates', ['getState'], 5000);
const actions = makeClient(inject, 'Updates', ['check', 'download', 'install', 'close'], 32 * 60 * 1000);

export default class Updates extends React.Component {
  static contextType = I18nContext;
  state = {stage: 'idle'};
  componentDidMount() { this.mounted = true; this.poll(); }
  componentWillUnmount() { this.mounted = false; clearTimeout(this.timer); }
  poll = async () => {
    try {
      const state = await status.getState();
      if (this.mounted) this.setState({...state, transportError: null});
    } catch (error) {
      if (this.mounted) this.setState({transportError: error.message});
    }
    if (this.mounted) this.timer = setTimeout(this.poll, 1500);
  };
  act = async method => {
    this.setState({sending: true, transportError: null});
    try {
      const state = await actions[method]();
      if (this.mounted) this.setState(state);
    } catch (error) {
      if (this.mounted) this.setState({transportError: error.message});
    } finally { if (this.mounted) this.setState({sending: false}); }
  };
  render() {
    const {t} = this.context;
    const {stage, version, target, progress, url, installable, error, transportError, sending} = this.state;
    const button = (key, action) => <button className="settings__content__section__cta" disabled={sending}
      onClick={() => this.act(action)}>{t(key)}</button>;
    return <section className="settings-updates" aria-labelledby="updates-title">
      <h2 id="updates-title">{t('updatesTitle')}</h2>
      <p>{t('updatesManual')}</p>
      {version && <p>{t('updatesVersion', version, target || version)}</p>}
      <p role="status" aria-live="polite">{t(`updatesStage_${stage}`)}
        {stage === 'downloading' && ` ${Math.round(progress || 0)}%`}</p>
      {(error || transportError) && <p role="alert">{error || transportError}</p>}
      {['idle', 'current', 'available', 'error'].includes(stage) && button('updatesCheck', 'check')}
      {stage === 'available' && installable && button('updatesDownload', 'download')}
      {stage === 'downloaded' && <><p>{t('updatesInstallSafety')}</p>{button('updatesInstall', 'install')}</>}
      {stage === 'installFailed' && button('updatesClose', 'close')}
      {url && <p><Anchor href={url}>{t('updatesReleasePage')}</Anchor></p>}
      {stage === 'available' && !installable && <p>{t('updatesManualInstall')}</p>}
    </section>;
  }
}

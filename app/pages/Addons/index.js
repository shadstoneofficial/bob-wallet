import React, {Component} from 'react';
import {shell} from 'electron';
import {withRouter} from 'react-router-dom';
import PropTypes from 'prop-types';
import {I18nContext} from '../../utils/i18n';
import './addons.scss';

const ADDONS = [
  {
    name: 'Shakedex Marketplace',
    status: 'Available',
    description: 'Browse pending and active Shakedex channel listings from inside Bob.',
    action: 'Open',
    href: '/exchange',
    internal: true,
  },
  {
    name: 'Liquidity Spot',
    status: 'Coming Soon',
    description: 'P2P swap workflows for HNS and related assets, designed as the first trusted Bob addon.',
    action: 'Preview',
    href: 'https://liquidity.spot',
  },
  {
    name: 'Resolver Directory',
    status: 'Planned',
    description: 'Find working Handshake resolvers and see their health before changing your setup.',
  },
  {
    name: 'Agentic Web',
    status: 'Research',
    description: 'Agent-friendly tools built around HNS TXT records and the hns.bio standard.',
  },
  {
    name: 'SLD Manager',
    status: 'Research',
    description: 'Help TLD owners run nameservers and manage second-level domains without DNS guesswork.',
  },
];

class Addons extends Component {
  static propTypes = {
    history: PropTypes.object.isRequired,
  };

  static contextType = I18nContext;

  openAddon(addon) {
    if (!addon.href)
      return;

    if (addon.internal) {
      this.props.history.push(addon.href);
      return;
    }

    shell.openExternal(addon.href);
  }

  render() {
    const {t} = this.context;

    return (
      <div className="addons-page">
        <div className="addons-page__intro">
          <div>
            <h2>{t('moreAddonsTitle')}</h2>
            <p>{t('moreAddonsIntro')}</p>
          </div>
          <button
            className="addons-page__docs-button"
            onClick={() => shell.openExternal('https://bobwallet.org')}
          >
            {t('openDocs')}
          </button>
        </div>
        <div className="addons-page__grid">
          {ADDONS.map(addon => (
            <div className="addons-page__card" key={addon.name}>
              <div className="addons-page__card-header">
                <h3>{addon.name}</h3>
                <span>{addon.status}</span>
              </div>
              <p>{addon.description}</p>
              {addon.href && (
                <button onClick={() => this.openAddon(addon)}>
                  {addon.action}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
}

export default withRouter(Addons);

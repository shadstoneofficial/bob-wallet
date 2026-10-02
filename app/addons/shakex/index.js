import {I18nContext} from '../../utils/i18n';
import {reviewText, reviewDate} from '../../utils/reviewText';
import React, {useContext, useEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {shell} from 'electron';
import {fetchListings, SHAKEX_ORIGIN} from './client';
import './shakex.scss';

export default function ShakeX() {
  const {t, locale} = useContext(I18nContext);
  const tr = (key, ...values) => reviewText(t, key, ...values);
  const [listings, setListings] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => () => {
    if (request.current) request.current.abort();
    request.current = null;
  }, []);

  async function load() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError('');
    try {
      const rows = await fetchListings(controller.signal);
      if (request.current === controller) {
        setListings(rows);
        setLoaded(true);
      }
    } catch (e) {
      if (request.current === controller) {
        setError(controller.signal.aborted
          ? 'shakexLoadTimeout'
          : 'shakexLoadError');
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  const filtered = listings.filter(item => item.name.includes(query.trim().toLowerCase()));
  return <section className="shakex-addon">
    <Link to="/addons">{tr('shakexBackToAddons')}</Link>
    <h2>ShakeX</h2>
    <p>{tr('shakexIntro')}</p>
    <p>{tr('shakexPrivacyMainnet')}</p>
    <p><Link to="/domain_manager">{tr('shakexManageListings')}</Link> — {tr('shakexManageListingsHelp')}</p>
    <div className="shakex-addon__actions">
      <button onClick={load} disabled={loading}>{loading ? tr('shakexLoading') : loaded ? tr('shakexRefresh') : tr('shakexLoad')}</button>
      <button onClick={() => shell.openExternal(SHAKEX_ORIGIN)}>{tr('shakexOpenSite')}</button>
      <button onClick={() => shell.openExternal(`${SHAKEX_ORIGIN}/docs`)}>{tr('shakexListingInstructions')}</button>
      <button onClick={() => shell.openExternal(`${SHAKEX_ORIGIN}/deal`)}>{tr('shakexDealGuide')}</button>
    </div>
    <p className="shakex-addon__notice">{tr('shakexSettlementNotice')}</p>
    {error && <p role="alert">{tr(error)}{loaded ? ` ${tr('shakexShowingPrevious')}` : ''}</p>}
    {loaded && <>
      <label>{tr('shakexSearchLabel')}
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={tr('shakexSearchPlaceholder')} />
      </label>
      <p role="status">{tr(filtered.length === 1 ? 'shakexListingCountOne' : 'shakexListingCountMany', filtered.length)}</p>
      {!filtered.length && <p>{listings.length ? tr('shakexNoMatches') : tr('shakexEmpty')}</p>}
      <div className="shakex-addon__list">
        {filtered.map(item => <article key={item.name}>
          <h3>{item.name}/</h3>
          <p>{item.prices.length ? item.prices.map(price => `${price.amount} ${price.unit}`).join(' · ') : tr('shakexContactForPrice')}</p>
          <ul>{item.contacts.map((contact, index) => <li key={index}>{contact}</li>)}</ul>
          <small>{tr('shakexLastVerified', item.verifiedAt ? reviewDate(item.verifiedAt, locale) : tr('shakexVerifiedUnknown'))}</small>
        </article>)}
      </div>
    </>}
  </section>;
}

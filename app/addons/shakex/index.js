import React, {useEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {shell} from 'electron';
import {fetchListings, SHAKEX_ORIGIN} from './client';
import './shakex.scss';

export default function ShakeX() {
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
          ? 'The request timed out. Please try again.'
          : 'Unable to load ShakeX listings. Please try again later or open ShakeX.');
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
    <Link to="/addons">← Add Ons</Link>
    <h2>ShakeX</h2>
    <p>Community name listings by Marioo. Browse asking prices and contact sellers to agree a deal.</p>
    <p>Listings are for Handshake mainnet. Loading contacts shakex.fun; no wallet addresses, balances or keys are sent.</p>
    <p><Link to="/domain_manager">Manage my listings in Domain Manager</Link> — open an owned name’s records to create, edit or remove its sale listing.</p>
    <div className="shakex-addon__actions">
      <button onClick={load} disabled={loading}>{loading ? 'Loading…' : loaded ? 'Refresh listings' : 'Load listings'}</button>
      <button onClick={() => shell.openExternal(SHAKEX_ORIGIN)}>Open ShakeX ↗</button>
      <button onClick={() => shell.openExternal(`${SHAKEX_ORIGIN}/docs`)}>Listing instructions ↗</button>
      <button onClick={() => shell.openExternal(`${SHAKEX_ORIGIN}/deal`)}>Deal guide ↗</button>
    </div>
    <p className="shakex-addon__notice">An asking price is not a signed sale offer. For HNS settlement, use Bob’s Finalize With Payment and Claim Name For Payment flow. Do not send a separate payment expecting the seller to transfer later. Network fees apply.</p>
    {error && <p role="alert">{error}{loaded ? ' Previously loaded listings remain below.' : ''}</p>}
    {loaded && <>
      <label>Search names (ASCII / punycode)
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search names" />
      </label>
      <p role="status">{filtered.length} listing{filtered.length === 1 ? '' : 's'}. Seller contacts are shown as published, not verified identities.</p>
      {!filtered.length && <p>{listings.length ? 'No names match your search.' : 'No listings are available.'}</p>}
      <div className="shakex-addon__list">
        {filtered.map(item => <article key={item.name}>
          <h3>{item.name}/</h3>
          <p>{item.prices.length ? item.prices.map(price => `${price.amount} ${price.unit}`).join(' · ') : 'Contact seller for price'}</p>
          <ul>{item.contacts.map((contact, index) => <li key={index}>{contact}</li>)}</ul>
          <small>Last checked by ShakeX: {item.verifiedAt ? new Date(item.verifiedAt).toLocaleString() : 'Unknown'}. Recheck before a deal.</small>
        </article>)}
      </div>
    </>}
  </section>;
}

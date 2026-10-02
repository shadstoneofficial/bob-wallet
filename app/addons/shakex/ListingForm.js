import React, {useState} from 'react';

export default function ListingForm({disabled, onStage, resource}) {
  const [price, setPrice] = useState('');
  const [contact, setContact] = useState('');
  const saleValues = ((resource && resource.records) || [])
    .filter(record => record.type === 'TXT')
    .flatMap(record => record.txt || []).filter(value => value.startsWith('v=FORSALE1;'));
  return <fieldset className="shakex-listing-form" disabled={disabled}>
    <legend>ShakeX sale listing</legend>
    <p>Publish an HNS asking price and contact, or remove your sale listing. Existing sale records are replaced; other DNS and profile records are preserved. ShakeX indexes mainnet only.</p>
    {saleValues.length > 0 && <details><summary>Current sale records ({saleValues.length})</summary>
      {saleValues.map((value, index) => <pre key={index}>{value}</pre>)}
    </details>}
    <label>Asking price (HNS; blank for offers)
      <input value={price} onChange={event => setPrice(event.target.value)} placeholder="5000" inputMode="decimal" />
    </label>
    <label>Sale contact
      <input value={contact} onChange={event => setContact(event.target.value)} placeholder="X @alice or email alice@example.com" />
    </label>
    <button type="button" onClick={() => onStage({price, contact})}>Review listing changes</button>
    <button type="button" onClick={() => onStage({remove: true})}>Review removal</button>
    <p>Review stages a draft. Submit below uses Bob’s normal wallet signing flow. Network fees apply.</p>
  </fieldset>;
}

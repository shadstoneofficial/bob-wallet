import {I18nContext} from '../../utils/i18n';
import {reviewText} from '../../utils/reviewText';
import React, {useContext, useState} from 'react';

export default function ListingForm({disabled, onStage, resource}) {
  const {t} = useContext(I18nContext);
  const tr = (key, ...values) => reviewText(t, key, ...values);
  const [price, setPrice] = useState('');
  const [contact, setContact] = useState('');
  const saleValues = ((resource && resource.records) || [])
    .filter(record => record.type === 'TXT')
    .flatMap(record => record.txt || []).filter(value => value.startsWith('v=FORSALE1;'));
  return <fieldset className="shakex-listing-form" disabled={disabled}>
    <legend>{tr('shakexSaleLegend')}</legend>
    <p>{tr('shakexSaleHelp')}</p>
    {saleValues.length > 0 && <details><summary>{tr('shakexCurrentRecords', saleValues.length)}</summary>
      {saleValues.map((value, index) => <pre key={index}>{value}</pre>)}
    </details>}
    <label>{tr('shakexPriceLabel')}
      <input value={price} onChange={event => setPrice(event.target.value)} placeholder="5000" inputMode="decimal" />
    </label>
    <label>{tr('shakexContactLabel')}
      <input value={contact} onChange={event => setContact(event.target.value)} placeholder={tr('shakexContactPlaceholder')} />
    </label>
    <button type="button" onClick={() => onStage({price, contact})}>{tr('shakexReviewChanges')}</button>
    <button type="button" onClick={() => onStage({remove: true})}>{tr('shakexReviewRemoval')}</button>
    <p>{tr('shakexReviewHelp')}</p>
  </fieldset>;
}

import React, {useEffect, useMemo, useState} from 'react';
import {useStore} from 'react-redux';
import {AuctionBasket} from '../../pages/AuctionBasket';
import {sendBidMany} from '../../ducks/names';
import {GET_PASSPHRASE} from '../../ducks/walletReducer';
import {makeClient} from '../ipc/ipc';
import ListingForm from '../../addons/shakex/ListingForm';
import ShakeX from '../../addons/shakex';
import {buildSaleReview} from '../../addons/shakex/records';
import {Resource} from 'hsd/lib/dns/resource';
import {FIXED_RESOURCE} from './data';
import './fixture.scss';
export {FIXED_RESOURCE} from './data';

const acceptance = makeClient(() => require('electron').ipcRenderer, 'Acceptance', ['describe']);

export default function InteractiveFixture() {
  const store = useStore();
  const [fixture, setFixture] = useState(null);
  const [visible, setVisible] = useState(true);
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState(null);
  useEffect(() => {
    let active = true;
    const update = () => acceptance.describe().then(value => {if(active)setFixture(value);})
      .catch(error => {if(active)setNotice(error.message);});
    update();
    const timer = setInterval(update, 500);
    return () => {active=false;clearInterval(timer);};
  }, []);
  const names = useMemo(() => fixture
    ? fixture.plan.names || (fixture.plan.name ? [fixture.plan.name] : [])
    : [], [fixture?.plan.scenario]);
  const items = useMemo(() => Object.fromEntries(names.map(name => [name, {
    name, bidAmount: '1', blindAmount: '1',
  }])), [names]);
  if (!fixture) return <main><p>Preparing isolated acceptance fixture...</p><p role="alert">{notice}</p></main>;
  const getState = () => ({...store.getState(), wallet:{wid:fixture.walletId,type:'hot',watchOnly:false}});
  const dispatch = action => {
    if (typeof action === 'function') return action(dispatch, getState);
    if (action?.type === GET_PASSPHRASE) return action.payload.resolve();
    return store.dispatch(action);
  };
  const submit = (entries, options) => sendBidMany(entries, options)(dispatch, getState);
  const stage = values => {
    try {
      const hex = Resource.fromJSON(FIXED_RESOURCE).encode().toString('hex');
      const result = buildSaleReview(hex, values);
      const unchanged = result.afterResource.records.filter(record => record.type !== 'TXT'
        || !record.txt.some(text => text.startsWith('v=FORSALE1;')));
      const before = result.beforeResource.records.filter(record => record.type !== 'TXT'
        || !record.txt.some(text => text.startsWith('v=FORSALE1;')));
      if (JSON.stringify(unchanged) !== JSON.stringify(before)) throw new Error('Unrelated DNS records changed.');
      setReview(result);setNotice('Fixed local resource review preserves NS, DS and ordinary TXT records. Submission is disabled.');
    } catch(error) {setNotice(error.message);}
  };
  return <main className="acceptance-fixture">
    <h2>Isolated acceptance: {fixture.plan.scenario}</h2>
    <p role="alert">{notice}</p>
    <button type="button" onClick={()=>setVisible(value=>!value)}>{visible?'Leave basket':'Return to basket'}</button>
    <pre data-testid="acceptance-state">{JSON.stringify(fixture.state,null,2)}</pre>
    {fixture.plan.fixtureType === 'restore-history' && <pre data-testid="acceptance-restore-evidence">
      {JSON.stringify(fixture.restoreEvidence || {status: 'Preparing generated regtest replay'}, null, 2)}
    </pre>}
    {visible && names.length>0 && <AuctionBasket
      order={names} items={items} network="regtest" walletId={fixture.walletId}
      spendableBalance={1000000000000} watchOnly={false} walletType="hot"
      addNamesToBasket={()=>({added:0})} removeFromBasket={()=>{}}
      updateBasketItem={()=>{}} importBasketRows={()=>{}} clearBasket={()=>setNotice('Unexpected basket clear')}
      sendBidMany={submit} showError={setNotice} showSuccess={setNotice} history={{push:()=>setVisible(false)}}
    />}
    <ListingForm resource={FIXED_RESOURCE} onStage={stage} disabled={false}/>
    {review && <pre data-testid="acceptance-resource-review">{JSON.stringify(review,null,2)}</pre>}
    <ShakeX />
  </main>;
}

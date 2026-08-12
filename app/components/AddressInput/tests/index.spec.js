import test from 'tape';
import sinon from 'sinon';

import {AddressInput} from '..';
import hip2 from '../../../utils/hip2Client';

function createAddressInput() {
  const setServers = sinon.stub(hip2, 'setServers').resolves();
  const component = new AddressInput({
    isSynchronized: true,
    noDns: false,
    hip2Port: 9892,
    network: 'main',
    onAddress() {},
  });
  setServers.restore();

  component.context = {t: value => value};
  component.setState = (update, callback) => {
    const value = typeof update === 'function'
      ? update(component.state, component.props)
      : update;
    component.state = {...component.state, ...value};
    callback?.();
  };

  return component;
}

test('typed HIP-2 aliases wait for an explicit completion action', t => {
  const component = createAddressInput();
  const resolve = sinon.stub(component, '_resolveHip2Address');

  component.onInputChange('@hnsbroker.hns.bio');
  t.equal(resolve.callCount, 0, 'typing does not start a partial lookup');
  t.equal(component.state.loading, false);

  component.resolveCurrentHip2Address();
  t.equal(resolve.callCount, 1, 'Enter or blur starts the lookup');
  t.equal(resolve.firstCall.args[0], 'hnsbroker.hns.bio');
  t.end();
});

test('pasted HIP-2 aliases resolve immediately', t => {
  const component = createAddressInput();
  const resolve = sinon.stub(component, '_resolveHip2Address');

  component.onInputChange('@hnsbroker.hns.bio', true);
  t.equal(resolve.callCount, 1);
  t.equal(resolve.firstCall.args[0], 'hnsbroker.hns.bio');
  t.end();
});

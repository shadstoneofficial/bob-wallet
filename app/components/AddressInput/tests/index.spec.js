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

test('HIP-2 client follows resolver port changes', t => {
  const component = createAddressInput();
  const setServers = sinon.stub(hip2, 'setServers').resolves();
  const previousProps = component.props;

  component.props = {...component.props, hip2Port: 10892};
  component.componentDidUpdate(previousProps);

  t.deepEqual(setServers.firstCall.args[0], ['127.0.0.1:10892']);
  setServers.restore();
  t.end();
});

test('alias failures show specific security and connection messages', async t => {
  const component = createAddressInput();
  component.state.input = '@hnsbroker.hns.bio';
  const fetchAddress = sinon.stub(hip2, 'fetchAddress');

  const securityError = new Error('invalid DANE');
  securityError.code = 'EINSECURE';
  fetchAddress.rejects(securityError);
  await component._resolveHip2Address('hnsbroker.hns.bio');
  t.equal(component.state.errorMessage, 'hip2InvalidTLSA');

  const tlsaError = new Error('TLSA mismatch');
  tlsaError.code = 'ETLSAMISMATCH';
  fetchAddress.rejects(tlsaError);
  await component._resolveHip2Address('hnsbroker.hns.bio');
  t.equal(component.state.errorMessage, 'hip2TLSAMismatch');

  const txtSecurityError = new Error('TXT is not authenticated');
  txtSecurityError.code = 'ETXTINSECURE';
  fetchAddress.rejects(txtSecurityError);
  await component._resolveHip2Address('hnsbroker.hns.bio');
  t.equal(component.state.errorMessage, 'hip2TXTInsecure');

  const connectionError = new Error('host lookup failed');
  connectionError.code = 'ENOTFOUND';
  fetchAddress.rejects(connectionError);
  await component._resolveHip2Address('hnsbroker.hns.bio');
  t.equal(component.state.errorMessage, 'hip2ConnectionFailed');

  fetchAddress.restore();
  t.end();
});

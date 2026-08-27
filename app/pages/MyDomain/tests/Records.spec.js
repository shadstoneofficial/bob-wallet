import test from 'tape';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mount} from 'enzyme';
import {Provider} from 'react-redux';
import {Records} from '../../../components/Records';

const fixture = require('../../../utils/tests/fixtures/activate-proposal-v1-addresses.json');

function makeRecords(overrides = {}) {
  let sendCalls = 0;
  let loadCalls = 0;
  const component = new Records({
    name: 'example',
    network: 'main',
    domain: {name: 'example', isOwner: true},
    resource: {records: []},
    pendingData: null,
    deeplinkParams: {},
    transferring: false,
    editable: true,
    canonicalLoading: false,
    canonicalError: '',
    currentHeight: 100,
    showSuccess() {},
    clearDeeplinkParams() {},
    async sendUpdate() {
      sendCalls += 1;
      return null;
    },
    async loadCanonicalNameInfo() {
      loadCalls += 1;
      return {info: {data: '00'}};
    },
    async refreshCanonicalNameInfo() {
      loadCalls += 1;
    },
    async openProposalFile() {
      return {canceled: false, filePaths: ['/authorized/proposal.json']};
    },
    async readProposalFile() {
      return Buffer.from(JSON.stringify(fixture));
    },
    ...overrides,
  });
  component.context = {t: key => key};
  component.setState = update => {
    const value = typeof update === 'function' ? update(component.state, component.props) : update;
    component.state = {...component.state, ...value};
  };
  return {component, sendCalls: () => sendCalls, loadCalls: () => loadCalls};
}

const carnageResource = {
  records: [
    {type: 'NS', ns: 'ns1.namebase.io.'},
    {type: 'NS', ns: 'ns2.namebase.io.'},
    {
      type: 'DS',
      keyTag: 27885,
      algorithm: 13,
      digestType: 2,
      digest: '33f86dde585bf7f2da39c08c26cef5bfd7507be1835c34300e601ad4713ee317',
    },
  ],
};

function mountRecords(overrides = {}) {
  const subject = makeRecords(overrides);
  const store = {
    dispatch() {},
    getState() {
      return {node: {chain: {height: 100}}};
    },
    subscribe() {
      return () => {};
    },
  };
  return {
    ...subject,
    wrapper: mount(<Records {...subject.component.props} />, {
      wrappingComponent: Provider,
      wrappingComponentProps: {store},
    }),
  };
}

test('Records replaces an initially stale empty draft when canonical records arrive', t => {
  const subject = mountRecords({name: 'carnage', resource: {records: []}});
  t.equal(subject.wrapper.find('.record__value').length, 0, 'stale resource starts empty');

  subject.wrapper.setProps({resource: carnageResource});

  t.deepEqual(
    subject.wrapper.state('updatedResource').records,
    carnageResource.records,
    'the clean draft follows the later canonical resource'
  );
  const html = subject.wrapper.html();
  t.match(html, /ns1\.namebase\.io\./);
  t.match(html, /ns2\.namebase\.io\./);
  t.match(html, /27885 13 2 33f86dde585bf7f2da39c08c26cef5bfd7507be1835c34300e601ad4713ee317/);
  subject.wrapper.unmount();
  t.end();
});

test('Records preserves a dirty local draft across a later canonical refresh', async t => {
  const subject = mountRecords({name: 'carnage', resource: {records: []}});
  const localRecord = {type: 'NS', ns: 'local.example.'};

  await subject.wrapper.instance().onCreate(localRecord);
  subject.wrapper.setProps({resource: carnageResource});

  t.deepEqual(subject.wrapper.state('updatedResource').records, [localRecord]);
  t.equal(subject.wrapper.state('isDirty'), true, 'local edit remains explicitly dirty');
  t.equal(
    subject.wrapper.find('.records-table__refresh-status__button').prop('disabled'),
    true,
    'refresh is disabled while the draft is dirty'
  );
  subject.wrapper.unmount();
  t.end();
});

test('Records refresh uses the name-info path without invoking wallet mutation actions', async t => {
  let refreshedName = null;
  let sendCalls = 0;
  const subject = mountRecords({
    name: 'carnage',
    async refreshCanonicalNameInfo(name) {
      refreshedName = name;
    },
    async sendUpdate() {
      sendCalls += 1;
      return null;
    },
  });

  await subject.wrapper.instance().refreshRecords();

  t.equal(refreshedName, 'carnage', 'refresh calls the canonical name-info callback');
  t.equal(sendCalls, 0, 'refresh does not invoke the UPDATE action');
  t.equal(subject.wrapper.state('isRefreshingRecords'), false);
  subject.wrapper.unmount();
  t.end();
});

test('Records add, edit, and remove operations continue to update the local draft', async t => {
  const subject = makeRecords({resource: {records: []}});
  await subject.component.onCreate({type: 'NS', ns: 'first.example.'});
  await subject.component.makeOnEdit(0)({type: 'NS', ns: 'edited.example.'});
  subject.component.onRemove(0);

  t.deepEqual(subject.component.state.updatedResource.records, []);
  t.equal(subject.component.state.isDirty, true);
  t.end();
});

test('Records deeplink additions remain staged as dirty local edits', t => {
  let cleared = 0;
  const subject = makeRecords({
    resource: {records: []},
    deeplinkParams: {ns: 'deeplink.example.'},
    clearDeeplinkParams() {
      cleared += 1;
    },
  });
  const nextState = Records.getDerivedStateFromProps(
    subject.component.props,
    subject.component.state
  );

  t.deepEqual(nextState.updatedResource.records, [{type: 'NS', ns: 'deeplink.example.'}]);
  t.equal(nextState.isDirty, true);
  t.equal(cleared, 1, 'deeplink parameters are cleared after staging');
  t.end();
});

test('Records hides an unresolved empty draft behind canonical loading and failure states', t => {
  const loading = makeRecords({canonicalLoading: true});
  const loadingHtml = renderToStaticMarkup(loading.component.render());
  t.match(loadingHtml, /Refreshing canonical records from the name tree/);
  t.notOk(/Add Record/.test(loadingHtml));

  const failed = makeRecords({canonicalError: 'name lookup timed out'});
  const failedHtml = renderToStaticMarkup(failed.component.render());
  t.match(failedHtml, /editable draft has not been changed/);
  t.match(failedHtml, /Refresh records/);
  t.notOk(/Add Record/.test(failedHtml));
  t.end();
});

test('Records import stages review without invoking the wallet update action', async t => {
  const subject = makeRecords();
  await subject.component.onImportProposal();
  t.equal(subject.loadCalls(), 1, 'canonical state is independently loaded');
  t.equal(subject.sendCalls(), 0, 'import does not invoke sendUpdate');
  t.ok(subject.component.state.importReview, 'a separate review is staged');
  t.deepEqual(subject.component.state.updatedResource, subject.component.state.importReview.afterResource);
  const reviewHtml = renderToStaticMarkup(subject.component.renderImportReview());
  t.match(reviewHtml, /Canonical before/);
  t.match(reviewHtml, /Complete result/);
  t.match(reviewHtml, /203\.0\.113\.8/);
  t.match(reviewHtml, /Import did not unlock, sign, broadcast, or update/);
  t.end();
});

test('Records submit rechecks canonical state before invoking the wallet action', async t => {
  const subject = makeRecords();
  const review = require('../../../utils/activateProposal').parseActivateProposal(JSON.stringify(fixture), {
    expectedName: 'example',
    expectedNetwork: 'main',
    currentResourceHex: '00',
  });
  subject.component.state = {
    ...subject.component.state,
    updatedResource: review.afterResource,
    importReview: review,
  };
  await subject.component.sendUpdate();
  t.equal(subject.loadCalls(), 1, 'canonical state is fetched again');
  t.equal(subject.sendCalls(), 1, 'submit invokes the existing wallet action only after the check');
  t.end();
});

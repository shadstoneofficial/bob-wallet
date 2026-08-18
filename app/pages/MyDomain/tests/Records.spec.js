import test from 'tape';
import {renderToStaticMarkup} from 'react-dom/server';
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

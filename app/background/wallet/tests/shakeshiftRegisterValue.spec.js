import test from 'tape';
import {parseShakeshiftRegisterValue} from '../shakeshiftRegisterValue';

test('parseShakeshiftRegisterValue prefers current lifecycle auction result', (t) => {
  const html = `
    <h2>Name State</h2>
    <div>
      <span>Name Value</span>
      <span data-tooltip="value" data-value="3078000000">3,078.00 HNS</span>
      <span>Lifecycle Value</span>
      <span data-tooltip="value" data-value="3001000000">3,001.00 HNS</span>
    </div>
    <h2>Auction Details</h2>
    <div>
      <span>State</span><span>Closed</span>
      <span>Result</span>
      <strong data-tooltip="value" data-value="3001000000">3,001.00 HNS</strong>
    </div>
    <h2>Bids</h2>
  `;

  t.equal(parseShakeshiftRegisterValue(html), 3001000000);
  t.end();
});

test('parseShakeshiftRegisterValue falls back to lifecycle value', (t) => {
  const html = `
    <span>Name Value</span>
    <span data-value="3078000000">3,078.00 HNS</span>
    <span>Lifecycle Value</span>
    <span data-value="3001000000">3,001.00 HNS</span>
  `;

  t.equal(parseShakeshiftRegisterValue(html), 3001000000);
  t.end();
});

test('parseShakeshiftRegisterValue falls back to name value', (t) => {
  const html = `
    <span>Name Value</span>
    <span data-value="58000000">58.00 HNS</span>
  `;

  t.equal(parseShakeshiftRegisterValue(html), 58000000);
  t.end();
});

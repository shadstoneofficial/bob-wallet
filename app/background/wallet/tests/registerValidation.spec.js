const test = require('tape');
const {
  applyRegisterAuthority,
  getRegisterAuthority,
} = require('../registerValidation');

const NAME = 'deshaw';
const NAME_HASH = '6d50e4a2951967cbda81de63b27288f16be191dd821b790df720ac119b89d9c8';
const OWNER_HASH = 'dd8e6c8d9f44205096498596f8324637d9af223ed820e12c2afc1b07eacb0279';

function nameInfo(overrides = {}) {
  return {
    start: {reserved: false, week: 12, start: 14112},
    info: {
      name: NAME,
      nameHash: NAME_HASH,
      state: 'CLOSED',
      height: 339252,
      owner: {hash: OWNER_HASH, index: 2},
      value: 3000000,
      highest: 588000000,
      registered: false,
      ...overrides,
    },
  };
}

function transaction({value = 6000000, ownerHash = OWNER_HASH, height = 339252} = {}) {
  return {
    inputs: [{
      prevout: {
        hash: Buffer.from(ownerHash, 'hex'),
        index: 2,
      },
    }],
    outputs: [{
      value,
      covenant: {
        getU32(index) {
          if (index !== 1)
            throw new Error('unexpected covenant item');
          return height;
        },
      },
    }],
  };
}

test('REGISTER uses helper info.value without display-unit conversion', t => {
  const authority = getRegisterAuthority(NAME, NAME_HASH, nameInfo());
  const mtx = transaction({value: 6000000});

  applyRegisterAuthority(NAME, mtx, 0, authority);

  t.equal(authority.value, 3000000, 'preserves the helper value in dollary');
  t.equal(mtx.outputs[0].value, 3000000, 'repairs the local 6 HNS value to 3 HNS');
  t.end();
});

test('REGISTER accepts a zero-value auction win', t => {
  const authority = getRegisterAuthority(NAME, NAME_HASH, nameInfo({value: 0}));
  const mtx = transaction();

  applyRegisterAuthority(NAME, mtx, 0, authority);

  t.equal(mtx.outputs[0].value, 0);
  t.end();
});

test('REGISTER fails closed when helper and wallet owners disagree', t => {
  const authority = getRegisterAuthority(NAME, NAME_HASH, nameInfo());
  const mtx = transaction({ownerHash: '00'.repeat(32)});

  t.throws(
    () => applyRegisterAuthority(NAME, mtx, 0, authority),
    /disagree about the auction winner/,
  );
  t.end();
});

test('REGISTER fails closed when helper and wallet heights disagree', t => {
  const authority = getRegisterAuthority(NAME, NAME_HASH, nameInfo());
  const mtx = transaction({height: 339251});

  t.throws(
    () => applyRegisterAuthority(NAME, mtx, 0, authority),
    /disagree about the auction height/,
  );
  t.end();
});

test('REGISTER rejects missing or non-closed helper state', t => {
  t.throws(
    () => getRegisterAuthority(NAME, NAME_HASH, {start: {}, info: null}),
    /returned no current name state/,
  );
  t.throws(
    () => getRegisterAuthority(NAME, NAME_HASH, nameInfo({state: 'REVEAL'})),
    /not CLOSED/,
  );
  t.end();
});

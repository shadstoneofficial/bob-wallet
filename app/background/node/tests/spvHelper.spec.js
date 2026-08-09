const test = require('tape');
const {
  DEFAULT_SPV_HELPER_API_BASE_URL,
  normalizeSpvHelperApiBaseUrl,
  resolveStoredSpvHelperApiBaseUrl,
} = require('../spvHelper');

test('new and reset installations use the LearnHNS SPV helper', t => {
  t.equal(normalizeSpvHelperApiBaseUrl(''), DEFAULT_SPV_HELPER_API_BASE_URL);
  t.equal(
    normalizeSpvHelperApiBaseUrl('spv.learnhns.com/hsd/'),
    DEFAULT_SPV_HELPER_API_BASE_URL,
  );
  t.end();
});

test('the retired default migrates without changing custom helpers', t => {
  t.equal(
    resolveStoredSpvHelperApiBaseUrl('https://api.handshakeapi.com/hsd'),
    DEFAULT_SPV_HELPER_API_BASE_URL,
    'moves the retired Bob default to LearnHNS',
  );
  t.equal(
    resolveStoredSpvHelperApiBaseUrl('https://helper.example/hsd/'),
    'https://helper.example/hsd',
    'preserves a custom provider',
  );
  t.end();
});

import test from 'tape';
import {
  getLiquiditySwapRoomUrl,
  getSafeExternalUrl,
  getSafeLiquidityIntentUrl,
} from '../urlPolicy';
import {isPrivateNetworkAddress} from '../../background/setting/safeChannelFetch';

test('external URL policy allows HTTPS without credentials', t => {
  t.equal(getSafeExternalUrl('https://handshake.org/faq'), 'https://handshake.org/faq');
  t.equal(getSafeExternalUrl('http://handshake.org'), null);
  t.equal(getSafeExternalUrl('file:///tmp/wallet'), null);
  t.equal(getSafeExternalUrl('javascript:alert(1)'), null);
  t.equal(getSafeExternalUrl('https://user:pass@example.com'), null);
  t.equal(getSafeExternalUrl('not a url'), null);
  t.equal(getSafeExternalUrl(`https://example.com/${'a'.repeat(2048)}`), null);
  t.end();
});

test('liquidity intent policy validates host and API path', t => {
  const intent = 'https://liquidity.spot/api/swaps/42/wallet-intents';
  t.equal(getSafeLiquidityIntentUrl(intent), intent);
  t.equal(getLiquiditySwapRoomUrl(intent), 'https://liquidity.spot/swaps/42');
  t.equal(getSafeLiquidityIntentUrl('https://evil.example/api/swaps/42/wallet-intents'), null);
  t.equal(getSafeLiquidityIntentUrl('https://liquidity.spot/api/users/42'), null);
  t.equal(getSafeLiquidityIntentUrl('https://liquidity.spot.evil.example/api/swaps/42/wallet-intents'), null);
  t.equal(getSafeLiquidityIntentUrl('https://user:pass@liquidity.spot/api/swaps/42/wallet-intents'), null);
  t.end();
});

test('liquidity intent policy can allow an explicitly configured channel', t => {
  const intent = 'https://channel.example:8443/api/swaps/7/wallet-intents';
  t.equal(getSafeLiquidityIntentUrl(intent, ['channel.example:8443']), intent);
  t.equal(getLiquiditySwapRoomUrl(intent, ['channel.example:8443']), 'https://channel.example:8443/swaps/7');
  t.end();
});

test('custom channel network policy rejects private and special IP ranges', t => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.168.1.1', '224.0.0.1', '::', '::1', 'fc00::1', 'fe80::1',
  ]) {
    t.equal(isPrivateNetworkAddress(address), true, `${address} is rejected`);
  }
  t.equal(isPrivateNetworkAddress('1.1.1.1'), false, 'public IPv4 is allowed');
  t.equal(isPrivateNetworkAddress('2606:4700:4700::1111'), false, 'public IPv6 is allowed');
  t.end();
});

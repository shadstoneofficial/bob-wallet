export function secureRandomHex(byteLength, cryptoProvider) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) {
    throw new RangeError('Random byte length must be a positive safe integer.');
  }
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') {
    throw new Error('A cryptographically secure random provider is required.');
  }

  const bytes = new Uint8Array(byteLength);
  cryptoProvider.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

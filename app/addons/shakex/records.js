import {Resource} from 'hsd/lib/dns/resource';

const PREFIX = 'v=FORSALE1;';

export function buildSaleReview(rawHex, {price = '', contact = '', remove = false} = {}) {
  if (typeof rawHex !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(rawHex) || rawHex.length > 1024) {
    throw new Error('Could not read the complete current name resource.');
  }
  let resource;
  try {
    resource = Resource.decode(Buffer.from(rawHex, 'hex'));
  } catch (error) {
    throw new Error('The current resource contains malformed or unsupported data.');
  }
  if (resource.encode().toString('hex') !== rawHex.toLowerCase()) {
    throw new Error('The current resource contains unsupported data.');
  }
  const beforeResource = resource.toJSON();
  const records = beforeResource.records.filter(record => {
    if (record.type !== 'TXT' || !record.txt.some(value => value.startsWith(PREFIX))) return true;
    if (record.txt.length !== 1) throw new Error('A sale record contains multiple strings. Edit it manually to avoid removing unrelated data.');
    return false;
  });
  if (!remove) {
    const amount = price.trim();
    const text = contact.trim();
    if (amount && (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(amount) || !/[1-9]/.test(amount))) {
      throw new Error('Enter a positive HNS price with at most six decimal places, or leave it blank for offers.');
    }
    if (!text || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text)) {
      throw new Error('Enter a sale contact without control or direction-changing characters.');
    }
    const contactRecord = `${PREFIX}ftxt=${text}`;
    if (Buffer.byteLength(contactRecord, 'utf8') > 255) throw new Error('Contact is too long for one TXT record (255 bytes including its prefix).');
    if (amount) records.push({type: 'TXT', txt: [`${PREFIX}fval=HNS${amount}`]});
    records.push({type: 'TXT', txt: [contactRecord]});
  }
  const finalResource = Resource.fromJSON({records});
  let encoded;
  try {
    encoded = finalResource.encode();
  } catch (error) {
    throw new Error('The complete resource could not be encoded; the limit is 512 bytes. Shorten the listing and preserve your existing DNS records.');
  }
  if (encoded.length > 512) throw new Error(`The complete resource needs ${encoded.length} bytes; the limit is 512. Shorten the listing and preserve your existing DNS records.`);
  if (encoded.toString('hex') === rawHex.toLowerCase()) throw new Error(remove ? 'There are no sale records to remove.' : 'These sale records are already published.');
  return {
    kind: 'shakex', proposal: {version: 1},
    canonicalResourceHex: rawHex.toLowerCase(),
    beforeResource, afterResource: finalResource.toJSON(),
    bytes: encoded.length,
  };
}

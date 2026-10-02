import {reviewText} from '../../utils/reviewText';
import {Resource} from 'hsd/lib/dns/resource';

const PREFIX = 'v=FORSALE1;';

export function buildSaleReview(rawHex, {price = '', contact = '', remove = false} = {}, t) {
  const tr = (key, ...values) => reviewText(t, key, ...values);
  if (typeof rawHex !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(rawHex) || rawHex.length > 1024) {
    throw new Error(tr('shakexResourceUnreadable'));
  }
  let resource;
  try {
    resource = Resource.decode(Buffer.from(rawHex, 'hex'));
  } catch (error) {
    throw new Error(tr('shakexResourceMalformed'));
  }
  if (resource.encode().toString('hex') !== rawHex.toLowerCase()) {
    throw new Error(tr('shakexResourceUnsupported'));
  }
  const beforeResource = resource.toJSON();
  const records = beforeResource.records.filter(record => {
    if (record.type !== 'TXT' || !record.txt.some(value => value.startsWith(PREFIX))) return true;
    if (record.txt.length !== 1) throw new Error(tr('shakexMixedRecord'));
    return false;
  });
  if (!remove) {
    const amount = price.trim();
    const text = contact.trim();
    if (amount && (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(amount) || !/[1-9]/.test(amount))) {
      throw new Error(tr('shakexInvalidPrice'));
    }
    if (!text || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text)) {
      throw new Error(tr('shakexInvalidContact'));
    }
    const contactRecord = `${PREFIX}ftxt=${text}`;
    if (Buffer.byteLength(contactRecord, 'utf8') > 255) throw new Error(tr('shakexContactTooLong'));
    if (amount) records.push({type: 'TXT', txt: [`${PREFIX}fval=HNS${amount}`]});
    records.push({type: 'TXT', txt: [contactRecord]});
  }
  const finalResource = Resource.fromJSON({records});
  let encoded;
  try {
    encoded = finalResource.encode();
  } catch (error) {
    throw new Error(tr('shakexResourceEncodeLimit'));
  }
  if (encoded.length > 512) throw new Error(tr('shakexResourceSizeLimit', encoded.length));
  if (encoded.toString('hex') === rawHex.toLowerCase()) throw new Error(remove ? tr('shakexNoSaleRecords') : tr('shakexAlreadyPublished'));
  return {
    kind: 'shakex', proposal: {version: 1},
    canonicalResourceHex: rawHex.toLowerCase(),
    beforeResource, afterResource: finalResource.toJSON(),
    bytes: encoded.length,
  };
}

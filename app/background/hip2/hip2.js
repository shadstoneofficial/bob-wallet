// Based on:
// - https://github.com/Falci/well-known-wallets-hns/blob/master/lib.js
// - https://github.com/lukeburns/hip2-dane/blob/main/index.js

import isValidAddress from '../../utils/verifyAddress';
import {
  aliasError,
  normalizeHostname,
  parseHNSAddressTXT,
  selectAliasError,
  shouldFallbackToTXT,
} from './alias';

const hdns = require('hdns');
const https = require('https');
const {codes, types} = require('bns/lib/wire');

const MAX_LENGTH = 90;

const verifyTLSA = async (cert, host) => {
  try {
    const tlsa = await hdns.resolveTLSA(host, 'tcp', 443);
    return hdns.verifyTLSA(tlsa[0], cert.raw);
  } catch (e) {
    if (e.code === 'ENODATA' || e.code === 'ENOTFOUND') {
      throw aliasError('TLSA record not found', 'ETLSANOTFOUND');
    }

    console.error(e);
    throw e;
  }
};

async function getHIP2Address(host, network) {
  let certificate = undefined;

  return new Promise(async (resolve, reject) => {
    const options = {
      rejectUnauthorized: false,
      lookup: hdns.legacy,
    };

    const req = https.get(`https://${host}/.well-known/wallets/HNS`, options, res => {
      res.setEncoding('utf8');

      let data = '';

      res.on('data', chunk => {
        // undefined = not yet stored
        // null = socket destroyed
        // object = may contain certificate
        if (certificate === undefined) {
          certificate = res.socket.getPeerCertificate(false);
        }

        const newLine = chunk.indexOf('\n');
        if (newLine >= 0) {
          req.destroy();
          chunk = chunk.slice(0, newLine);
        }

        if (data.length + chunk.length > MAX_LENGTH) {
          if (!req.destroyed) {
            req.destroy();
          }
          const error = new Error('response too large');
          error.code = 'ELARGE';
          return reject(error);
        }

        data += chunk;
      })

      res.on('end', async () => {
        try {
          const dane = await verifyTLSA(certificate, host);
          if (!dane) {
            const error = new Error('invalid DANE');
            error.code = 'ETLSAMISMATCH';
            return reject(error);
          }

          if (res.statusCode >= 400) {
            const error = new Error(res.statusMessage);
            error.code = res.statusCode;
            return reject(error);
          }

          const addr = data.trim();

          if (!isValidAddress(addr, network)) {
            const error = new Error('invalid address');
            error.code = 'EINVALID';
            return reject(error);
          }

          return resolve(addr);
        } catch (error) {
          return reject(error);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

export async function getTXTAddress(host, network) {
  const response = await hdns.resolveRaw(host, 'TXT');

  if (response.code === codes.NXDOMAIN) {
    throw aliasError('HNS TXT record not found', 'ETXTNOTFOUND');
  }

  if (response.code !== codes.NOERROR) {
    throw aliasError('TXT lookup failed', 'EDNS');
  }

  if (!response.ad) {
    throw aliasError('TXT response is not authenticated', 'ETXTINSECURE');
  }

  const records = response.collect(host, types.TXT).map((record) => {
    // bns decodes TXT character-strings as JavaScript strings. Joining the
    // chunks preserves multi-string records without assuming Buffer values.
    return record.data.txt.join('');
  });

  return parseHNSAddressTXT(records, network);
}

export async function getAddress(input, network) {
  const host = normalizeHostname(input);

  try {
    return await getHIP2Address(host, network);
  } catch (error) {
    if (!shouldFallbackToTXT(error)) {
      throw error;
    }

    try {
      return await getTXTAddress(host, network);
    } catch (txtError) {
      throw selectAliasError(error, txtError);
    }
  }
}

export const { setServers } = hdns;

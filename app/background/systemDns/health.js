const dgram = require('dgram');
const net = require('net');
const crypto = require('crypto');
const wire = require('bns/lib/wire');
const {isLoopbackHost, isValidPort, resolverError} = require('./contract');

function createQuery(name, type, id = crypto.randomBytes(2).readUInt16BE(0)) {
  try {
    const message = new wire.Message();
    message.id = id;
    message.flags = wire.flags.RD | wire.flags.AD;
    message.question.push(new wire.Question(name, type));
    return message.encode();
  } catch (error) {
    throw resolverError('EPROBEINPUT', 'Invalid DNS probe name or type.');
  }
}

function parseResponse(packet, id) {
  let message;
  try {
    message = wire.Message.decode(packet);
  } catch (error) {
    throw resolverError('EMALFORMED', 'Malformed DNS response.');
  }
  if (message.malformed) throw resolverError('EMALFORMED', 'Malformed DNS response.');
  if (message.id !== id) throw resolverError('EMISMATCH', 'DNS response identifier mismatch.');
  if ((message.flags & wire.flags.QR) === 0) throw resolverError('EMALFORMED', 'DNS response flag is missing.');
  return {
    truncated: Boolean(message.flags & wire.flags.TC),
    authenticated: Boolean(message.flags & wire.flags.AD),
    rcode: message.code,
    answers: message.answer.length,
    answerTypes: message.answer.map(record => wire.typesByVal[record.type] || 'UNKNOWN'),
  };
}

function udpRequest({host, port, packet, timeoutMs}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(host === '::1' ? 'udp6' : 'udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(resolverError('ETIMEOUT', 'DNS UDP probe timed out.'));
    }, timeoutMs);
    socket.once('error', error => { clearTimeout(timer); socket.close(); reject(error); });
    socket.once('message', response => { clearTimeout(timer); socket.close(); resolve(response); });
    socket.send(packet, port, host);
  });
}

function tcpRequest({host, port, packet, timeoutMs}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host, port});
    const frame = Buffer.alloc(packet.length + 2);
    frame.writeUInt16BE(packet.length, 0);
    packet.copy(frame, 2);
    let data = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(resolverError('ETIMEOUT', 'DNS TCP probe timed out.'));
    }, timeoutMs);
    const fail = error => { clearTimeout(timer); socket.destroy(); reject(error); };
    socket.once('error', fail);
    socket.on('connect', () => socket.write(frame));
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length < 2) return;
      const length = data.readUInt16BE(0);
      if (length > 65535) return fail(resolverError('EMALFORMED', 'Invalid DNS TCP frame.'));
      if (data.length >= length + 2) {
        clearTimeout(timer);
        socket.end();
        resolve(data.subarray(2, length + 2));
      }
    });
  });
}

async function query(endpoint, name, type, {timeoutMs = 1500, forceTcp = false} = {}) {
  if (!isLoopbackHost(endpoint.host) || !isValidPort(endpoint.port)) {
    throw resolverError('EPROBEENDPOINT', 'DNS health checks require a loopback endpoint.');
  }
  const packet = createQuery(name, type);
  const id = packet.readUInt16BE(0);
  let response = forceTcp
    ? await tcpRequest({...endpoint, packet, timeoutMs})
    : await udpRequest({...endpoint, packet, timeoutMs});
  let parsed = parseResponse(response, id);
  if (parsed.truncated && !forceTcp) {
    response = await tcpRequest({...endpoint, packet, timeoutMs});
    parsed = parseResponse(response, id);
  }
  return {...parsed, requestedType: type};
}

async function runHealthChecks(endpoint, fixtures = {}) {
  const names = {
    hns: fixtures.hns || 'welcome.',
    icann: fixtures.icann || 'example.com.',
    dnssec: fixtures.dnssec || 'cloudflare.com.',
    tcp: fixtures.tcp || 'example.com.',
  };
  const results = {};
  const checks = [
    ['hns', names.hns, 'NS', false, true],
    ['icann', names.icann, 'A', false, false],
    ['dnssec', names.dnssec, 'DS', false, true],
    ['tcp', names.tcp, 'AAAA', true, false],
  ];
  for (const [key, name, type, forceTcp, requireAd] of checks) {
    try {
      const answer = await query(endpoint, name, type, {timeoutMs: fixtures.timeoutMs, forceTcp});
      const expectedAnswer = answer.answerTypes.includes(type) || answer.answerTypes.includes('CNAME');
      results[key] = answer.rcode === 0 && answer.answers > 0 && expectedAnswer
        && (!requireAd || answer.authenticated);
    } catch (error) {
      results[key] = false;
    }
  }
  return results;
}

module.exports = {createQuery, parseResponse, query, runHealthChecks};

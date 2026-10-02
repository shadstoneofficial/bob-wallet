const dgram = require('dgram');
const net = require('net');
const {
  isValidPort,
  resolverError,
} = require('./contract');

class LoopbackDnsBridge {
  constructor({
    listenHost = '127.0.0.1',
    listenPort = 0,
    upstreamHost = '127.0.0.1',
    upstreamPort,
    timeoutMs = 3000,
    maxConcurrent = 64,
    maxQueryBytes = 4096,
    maxResponseBytes = 65535,
  }) {
    if (listenHost !== '127.0.0.1') {
      throw resolverError('ELISTENHOST', 'The prototype bridge listens on IPv4 loopback only.');
    }
    if (listenPort !== 0 && (!isValidPort(listenPort) || listenPort < 1024)) {
      throw resolverError('EPRIVILEGEDPORT', 'The prototype bridge may use only ephemeral or unprivileged ports.');
    }
    if (upstreamHost !== '127.0.0.1' || !isValidPort(upstreamPort)) {
      throw resolverError('EUPSTREAM', 'The IPv4 prototype upstream must be a valid loopback endpoint.');
    }

    this.options = {
      listenHost,
      listenPort,
      upstreamHost,
      upstreamPort,
      timeoutMs,
      maxConcurrent,
      maxQueryBytes,
      maxResponseBytes,
    };
    this.udp = null;
    this.tcp = null;
    this.active = new Set();
  }

  async start() {
    if (this.udp || this.tcp) return this.address();

    const udp = dgram.createSocket('udp4');
    this.udp = udp;
    udp.on('message', (message, peer) => this._handleUdp(message, peer));

    await new Promise((resolve, reject) => {
      const onError = error => {
        udp.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        udp.off('error', onError);
        resolve();
      };
      udp.once('error', onError);
      udp.once('listening', onListening);
      udp.bind(this.options.listenPort, this.options.listenHost);
    });

    const port = udp.address().port;
    const tcp = net.createServer(socket => this._handleTcp(socket));
    this.tcp = tcp;
    try {
      await new Promise((resolve, reject) => {
        const onError = error => {
          tcp.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          tcp.off('error', onError);
          resolve();
        };
        tcp.once('error', onError);
        tcp.once('listening', onListening);
        tcp.listen(port, this.options.listenHost);
      });
    } catch (error) {
      await this.stop();
      throw error;
    }

    return this.address();
  }

  address() {
    if (!this.udp || !this.tcp) return null;
    return {host: this.options.listenHost, port: this.udp.address().port};
  }

  _hasCapacity() {
    return this.active.size < this.options.maxConcurrent;
  }

  _track(socket) {
    this.active.add(socket);
    const release = () => this.active.delete(socket);
    socket.once('close', release);
    return socket;
  }

  _handleUdp(message, peer) {
    if (!this._hasCapacity()
        || message.length < 12
        || message.length > this.options.maxQueryBytes) return;

    const upstream = this._track(dgram.createSocket('udp4'));
    const finish = () => {
      clearTimeout(timer);
      try { upstream.close(); } catch (error) {}
    };
    const timer = setTimeout(finish, this.options.timeoutMs);
    upstream.once('message', response => {
      if (response.length <= this.options.maxResponseBytes && this.udp) {
        this.udp.send(response, peer.port, peer.address, finish);
      } else {
        finish();
      }
    });
    upstream.once('error', finish);
    upstream.connect(
      this.options.upstreamPort,
      this.options.upstreamHost,
      () => upstream.send(message, error => { if (error) finish(); }),
    );
  }

  _handleTcp(client) {
    if (!this._hasCapacity()) {
      client.destroy();
      return;
    }

    this._track(client);
    client.setTimeout(this.options.timeoutMs, () => client.destroy());
    let buffer = Buffer.alloc(0);
    let handled = false;

    client.on('data', chunk => {
      if (handled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const length = buffer.readUInt16BE(0);
      if (length < 12 || length > this.options.maxQueryBytes) {
        client.destroy();
        return;
      }
      if (buffer.length < length + 2) return;
      handled = true;
      this._queryTcpUpstream(buffer.subarray(2, length + 2), client);
    });
    client.on('error', () => {});
  }

  _queryTcpUpstream(query, client) {
    const upstream = this._track(net.createConnection({
      host: this.options.upstreamHost,
      port: this.options.upstreamPort,
    }));
    upstream.setTimeout(this.options.timeoutMs, () => upstream.destroy());
    let response = Buffer.alloc(0);
    let expected = null;

    upstream.on('connect', () => {
      const frame = Buffer.alloc(query.length + 2);
      frame.writeUInt16BE(query.length, 0);
      query.copy(frame, 2);
      upstream.write(frame);
    });
    upstream.on('data', chunk => {
      response = Buffer.concat([response, chunk]);
      if (response.length >= 2 && expected === null) {
        expected = response.readUInt16BE(0);
        if (expected > this.options.maxResponseBytes) {
          upstream.destroy();
          client.destroy();
          return;
        }
      }
      if (expected !== null && response.length >= expected + 2) {
        client.end(response.subarray(0, expected + 2));
        upstream.end();
      }
    });
    upstream.on('timeout', () => client.destroy());
    upstream.on('error', () => client.destroy());
    client.once('close', () => upstream.destroy());
  }

  async stop() {
    for (const socket of [...this.active]) {
      try { socket.destroy ? socket.destroy() : socket.close(); } catch (error) {}
    }
    this.active.clear();

    const close = server => new Promise(resolve => {
      if (!server) return resolve();
      try { server.close(() => resolve()); } catch (error) { resolve(); }
    });
    const udp = this.udp;
    const tcp = this.tcp;
    this.udp = null;
    this.tcp = null;
    await Promise.all([close(udp), close(tcp)]);
  }
}

module.exports = {LoopbackDnsBridge};


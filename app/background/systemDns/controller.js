const {
  PHASES,
  createInitialStatus,
  resolverError,
  validateResolverContext,
} = require('./contract');
const {
  activateRestoreRecord,
  beginRestore,
  createRestoreRecord,
  validateRestoreRecord,
} = require('./restoreRecord');

function requirePassingProbe(result, path) {
  const checks = ['hns', 'icann', 'dnssec', 'tcp'];
  if (!result || checks.some(check => result[check] !== true)) {
    throw resolverError('EPROBE', `The ${path} resolver checks did not all pass.`);
  }
  return result;
}

class SystemDnsController {
  constructor({
    nodeProvider,
    bridge,
    platform,
    recordStore,
    probe,
    installId,
    helperVersion = 'prototype',
    platformName = process.platform,
    now = () => new Date().toISOString(),
  }) {
    for (const [name, dependency] of Object.entries({
      nodeProvider, bridge, platform, recordStore, probe,
    })) {
      if (!dependency) throw new TypeError(`Missing SystemDns dependency: ${name}`);
    }
    if (typeof installId !== 'string' || !installId) {
      throw new TypeError('SystemDns requires an installation identifier.');
    }

    Object.assign(this, {
      nodeProvider,
      bridge,
      platform,
      recordStore,
      probe,
      installId,
      helperVersion,
      platformName,
      now,
    });
    this.status = createInitialStatus();
    this.operation = null;
  }

  getStatus() {
    return JSON.parse(JSON.stringify(this.status));
  }

  _update(patch) {
    this.status = {...this.status, ...patch};
    return this.getStatus();
  }

  _errorStatus(error, phase = PHASES.OFF) {
    this._update({
      phase,
      lastCheckedAt: this.now(),
      lastError: {
        code: error.code || 'ESYSTEMDNS',
        message: error.message || 'System DNS operation failed.',
      },
    });
  }

  _serialize(name, action) {
    if (this.operation) {
      throw resolverError('EBUSY', `System DNS is already ${this.operation}.`);
    }
    this.operation = name;
    return Promise.resolve()
      .then(action)
      .finally(() => { this.operation = null; });
  }

  async _context() {
    return validateResolverContext(await this.nodeProvider.getResolverContext());
  }

  async _preflight() {
    this._update({phase: PHASES.PREFLIGHT, lastError: null});
    const context = await this._context();
    requirePassingProbe(await this.probe.direct({
      host: context.resolverHost,
      port: context.resolverPort,
    }), 'direct Bob');
    await this.platform.preflight();
    this._update({
      nodeMode: context.nodeMode,
      network: context.network,
      resolverState: 'ready',
      recursivePort: context.resolverPort,
      lastCheckedAt: this.now(),
    });
    return context;
  }

  _validateOwnershipRecord(record) {
    if (record.installId !== this.installId || record.platform !== this.platformName) {
      throw resolverError('EOWNERINSTANCE', 'The DNS recovery record belongs to another Bob installation or platform.');
    }
    return record;
  }

  async _restoreStoredRecord(stored) {
    const record = this._validateOwnershipRecord(validateRestoreRecord(stored));
    const ownership = await this.platform.inspectOwnership(record);
    if (!ownership || ownership.owned !== true) {
      throw resolverError(
        'EOWNERSHIP',
        'Bob found a DNS recovery record, but current system DNS is no longer Bob-owned.',
      );
    }
    const restoring = beginRestore(record);
    await this.recordStore.write(restoring);
    this._update({phase: PHASES.RESTORING_DNS, systemState: 'restoring'});
    await this.platform.restore(restoring);
    await this.platform.verifyRestored(restoring);
    await this.recordStore.clear();
    await this.bridge.stop();
  }

  async preflight() {
    return this._serialize('checking readiness', async () => {
      try {
        await this._preflight();
        this._update({phase: PHASES.OFF});
        return this.getStatus();
      } catch (error) {
        this._errorStatus(error);
        throw error;
      }
    });
  }

  async enable() {
    return this._serialize('enabling', async () => {
      let record = null;
      let bridgeStarted = false;
      this._update({desiredEnabled: true});
      try {
        const stale = await this.recordStore.read();
        if (stale) {
          this._update({phase: PHASES.RECONCILING, restoreAvailable: true});
          await this._restoreStoredRecord(stale);
          this.status = createInitialStatus();
          this._update({desiredEnabled: true});
        }
        const context = await this._preflight();
        this._update({phase: PHASES.STARTING_BRIDGE, bridgeState: 'starting'});
        const address = await this.bridge.start({
          upstreamHost: context.resolverHost,
          upstreamPort: context.resolverPort,
        });
        bridgeStarted = true;
        requirePassingProbe(await this.probe.bridge(address), 'loopback bridge');
        this._update({
          bridgeState: 'ready',
          bridgePort: address.port,
          phase: PHASES.CAPTURING_DNS,
        });

        const captured = await this.platform.capture();
        record = createRestoreRecord({
          installId: this.installId,
          platform: this.platformName,
          helperVersion: this.helperVersion,
          resolverHost: context.resolverHost,
          resolverPort: context.resolverPort,
          targets: captured.map(target => ({
            ...target,
            appliedServers: ['127.0.0.1'],
          })),
        });
        await this.recordStore.write(record);

        this._update({
          phase: PHASES.APPLYING_DNS,
          systemState: 'applying',
          restoreAvailable: true,
          activeInterfaces: record.targets.map(target => ({
            stableId: target.stableId,
            displayLabel: target.displayLabel,
          })),
        });
        await this.platform.apply(record, address);

        this._update({phase: PHASES.VERIFYING});
        requirePassingProbe(await this.probe.system(), 'operating-system');
        record = activateRestoreRecord(record);
        await this.recordStore.write(record);
        this._update({
          phase: PHASES.ON,
          systemState: 'active',
          lastCheckedAt: this.now(),
          lastError: null,
        });
        return this.getStatus();
      } catch (error) {
        let rollbackError = null;
        if (record) {
          try {
            await this.platform.rollback(record);
            await this.recordStore.clear();
          } catch (failure) {
            rollbackError = failure;
          }
        }
        if (bridgeStarted && !rollbackError) await this.bridge.stop();
        this._update({
          desiredEnabled: false,
          bridgeState: rollbackError ? 'ready' : 'stopped',
          bridgePort: rollbackError ? this.status.bridgePort : null,
          systemState: rollbackError ? 'stale' : 'unchanged',
          restoreAvailable: Boolean(rollbackError),
          activeInterfaces: rollbackError ? this.status.activeInterfaces : [],
        });
        const reported = rollbackError || error;
        this._errorStatus(
          reported,
          rollbackError ? PHASES.NEEDS_REPAIR : PHASES.OFF,
        );
        if (rollbackError) reported.cause = error;
        throw reported;
      }
    });
  }

  async disable() {
    return this._serialize('disabling', async () => {
      try {
        const stored = await this.recordStore.read();
        if (!stored) {
          await this.bridge.stop();
          this.status = createInitialStatus();
          return this.getStatus();
        }
        await this._restoreStoredRecord(stored);
        this._update({phase: PHASES.STOPPING_BRIDGE});
        this.status = createInitialStatus();
        return this.getStatus();
      } catch (error) {
        this._update({
          desiredEnabled: false,
          systemState: 'stale',
          restoreAvailable: true,
        });
        this._errorStatus(error, PHASES.NEEDS_REPAIR);
        throw error;
      }
    });
  }

  async reconcileOnStartup() {
    return this._serialize('reconciling startup state', async () => {
      this._update({phase: PHASES.RECONCILING});
      try {
        const stored = await this.recordStore.read();
        if (!stored) {
          this.status = createInitialStatus();
          return this.getStatus();
        }
        await this._restoreStoredRecord(stored);
        this.status = createInitialStatus();
        return this.getStatus();
      } catch (error) {
        this._update({
          desiredEnabled: false,
          systemState: 'stale',
          restoreAvailable: true,
        });
        this._errorStatus(error, PHASES.NEEDS_REPAIR);
        throw error;
      }
    });
  }
}

module.exports = {SystemDnsController, requirePassingProbe};

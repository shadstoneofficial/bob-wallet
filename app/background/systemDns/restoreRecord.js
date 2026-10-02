const crypto = require('crypto');
const {isLoopbackHost, isValidPort, resolverError} = require('./contract');

const SCHEMA_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateTarget(target) {
  if (!target || typeof target.stableId !== 'string' || !target.stableId) {
    throw resolverError('EBACKUP', 'A DNS backup target is missing its stable identifier.');
  }

  if (!['dhcp', 'static', 'empty'].includes(target.previousMode)) {
    throw resolverError('EBACKUP', 'A DNS backup target has an unsupported previous mode.');
  }

  if (!Array.isArray(target.previousServers)
      || !target.previousServers.every(value => typeof value === 'string')) {
    throw resolverError('EBACKUP', 'A DNS backup target has invalid previous servers.');
  }

  if (!Array.isArray(target.appliedServers)
      || target.appliedServers.length === 0
      || !target.appliedServers.every(isLoopbackHost)) {
    throw resolverError('EBACKUP', 'A DNS backup target must record Bob-owned loopback servers.');
  }

  return {
    stableId: target.stableId,
    displayLabel: typeof target.displayLabel === 'string' ? target.displayLabel : target.stableId,
    previousMode: target.previousMode,
    previousServers: [...target.previousServers],
    appliedServers: [...target.appliedServers],
  };
}

function createRestoreRecord({
  installId,
  transactionId = crypto.randomUUID(),
  createdAt = new Date().toISOString(),
  platform,
  helperVersion,
  resolverHost,
  resolverPort,
  targets,
}) {
  if (typeof installId !== 'string' || !installId) {
    throw resolverError('EBACKUP', 'The DNS backup requires a Bob installation identifier.');
  }
  if (typeof platform !== 'string' || !platform) {
    throw resolverError('EBACKUP', 'The DNS backup requires a platform identifier.');
  }
  if (typeof helperVersion !== 'string' || !helperVersion) {
    throw resolverError('EBACKUP', 'The DNS backup requires a helper version.');
  }
  if (!isLoopbackHost(resolverHost) || !isValidPort(resolverPort)) {
    throw resolverError('EBACKUP', 'The DNS backup contains an invalid Bob resolver endpoint.');
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw resolverError('EBACKUP', 'No system DNS targets were captured.');
  }

  const seen = new Set();
  const safeTargets = targets.map(validateTarget);
  for (const target of safeTargets) {
    if (seen.has(target.stableId)) {
      throw resolverError('EBACKUP', 'The DNS backup contains a duplicate target.');
    }
    seen.add(target.stableId);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    installId,
    transactionId,
    createdAt,
    platform,
    helperVersion,
    phase: 'pending',
    recursiveEndpoint: `${resolverHost}:${resolverPort}`,
    targets: safeTargets,
  };
}

function activateRestoreRecord(record) {
  validateRestoreRecord(record);
  return {...clone(record), phase: 'active'};
}

function validateRestoreRecord(record) {
  if (!record || record.schemaVersion !== SCHEMA_VERSION) {
    throw resolverError('EBACKUPSCHEMA', 'The DNS backup schema is unsupported.');
  }
  if (!['pending', 'active'].includes(record.phase)) {
    throw resolverError('EBACKUP', 'The DNS backup phase is invalid.');
  }
  if (typeof record.installId !== 'string' || !record.installId
      || typeof record.transactionId !== 'string' || !record.transactionId
      || typeof record.platform !== 'string' || !record.platform
      || typeof record.helperVersion !== 'string' || !record.helperVersion
      || !Array.isArray(record.targets) || record.targets.length === 0) {
    throw resolverError('EBACKUP', 'The DNS backup is incomplete.');
  }
  record.targets.forEach(validateTarget);
  return clone(record);
}

module.exports = {
  SCHEMA_VERSION,
  activateRestoreRecord,
  createRestoreRecord,
  validateRestoreRecord,
};


import fs from 'fs';

import {STORAGE_BLOCKED, STORAGE_CLEARED} from '../../ducks/storageReducer';

export const MIN_FREE_SPACE_BYTES = 10 * 1024 * 1024 * 1024;
export const STORAGE_BLOCKED_ERROR_CODE = 'BOB_LOW_STORAGE';

const STORAGE_ERROR_CODES = new Set([
  'ENOSPC',
  'EDQUOT',
  'SQLITE_FULL',
  'ERROR_DISK_FULL',
  'ERROR_HANDLE_DISK_FULL',
  'UV_ENOSPC',
]);

const STORAGE_ERROR_PATTERNS = [
  /no space left on device/i,
  /not enough space on (?:the )?disk/i,
  /disk(?: is)? full/i,
  /database or disk is full/i,
  /disk quota exceeded/i,
  /leveldb[^\n]*(?:no space|disk full)/i,
];

function errorChain(error) {
  const errors = [];
  const seen = new Set();
  let current = error;

  while (current && !seen.has(current) && errors.length < 5) {
    errors.push(current);
    seen.add(current);
    current = current.cause;
  }

  return errors;
}

export function isStorageFullError(error) {
  return errorChain(error).some((item) => {
    const code = String(item.code || '').toUpperCase();
    const errno = Number(item.errno);
    const text = [item.name, item.message, item.type, item.reason, item]
      .filter(Boolean)
      .join(' ');

    return STORAGE_ERROR_CODES.has(code)
      || errno === -28
      || errno === 28
      || errno === 112
      || errno === 39
      || STORAGE_ERROR_PATTERNS.some(pattern => pattern.test(text));
  });
}

function redactDiagnosticText(value) {
  return String(value || '')
    .replace(/\b(api[_-]?key|password|passphrase|mnemonic|seed|xpriv|token)\b\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .slice(0, 1000);
}

export function safeStorageDiagnostic(error, source) {
  const causes = errorChain(error).slice(1).map(item => ({
    code: String(item?.code || '').slice(0, 80),
    errno: Number.isFinite(Number(item?.errno)) ? Number(item.errno) : null,
    message: redactDiagnosticText(item?.message || item),
  }));

  return {
    source: String(source || 'unknown').slice(0, 80),
    code: String(error?.code || '').slice(0, 80),
    errno: Number.isFinite(Number(error?.errno)) ? Number(error.errno) : null,
    syscall: String(error?.syscall || '').slice(0, 80),
    message: redactDiagnosticText(error?.message || error),
    causes,
  };
}

export function availableBytesFromStat(stat) {
  const blocks = stat?.bavail ?? stat?.bfree;
  const blockSize = stat?.bsize;

  if (blocks == null || blockSize == null) {
    return null;
  }

  const available = BigInt(blocks) * BigInt(blockSize);
  return available > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(available);
}

export class StorageHealth {
  constructor({
    dispatch = () => {},
    statfs = targetPath => fs.promises.statfs(targetPath),
    logger = (...args) => console.error(...args),
    minimumBytes = MIN_FREE_SPACE_BYTES,
  } = {}) {
    this.dispatch = dispatch;
    this.statfs = statfs;
    this.logger = logger;
    this.minimumBytes = minimumBytes;
    this.status = null;
  }

  _publishBlocked({source, transactionAttempted = false, availableBytes = null}) {
    const status = {
      blocked: true,
      source,
      transactionAttempted: !!transactionAttempted || !!this.status?.transactionAttempted,
      availableBytes,
      requiredBytes: this.minimumBytes,
      checkedAt: Date.now(),
    };

    this.status = status;
    this.dispatch({type: STORAGE_BLOCKED, payload: status});
    return status;
  }

  reportError(error, {source = 'storage', transactionAttempted = false} = {}) {
    if (!isStorageFullError(error)) {
      return false;
    }

    this.logger('[Bob storage] Disk-full error', safeStorageDiagnostic(error, source));
    this._publishBlocked({source, transactionAttempted});
    return true;
  }

  async check(targetPath) {
    const stat = await this.statfs(targetPath);
    return availableBytesFromStat(stat);
  }

  async preflight(targetPath, {source = 'preflight', transactionAttempted = false} = {}) {
    let availableBytes;
    try {
      availableBytes = await this.check(targetPath);
    } catch (error) {
      if (this.reportError(error, {source, transactionAttempted})) {
        throw this.createBlockedError();
      }

      // A platform/filesystem that cannot report free space must not be
      // mistaken for a full disk. The actual storage error listeners remain active.
      this.logger('[Bob storage] Free-space preflight unavailable', safeStorageDiagnostic(error, source));
      return {ok: true, checked: false, availableBytes: null};
    }

    if (availableBytes != null && availableBytes < this.minimumBytes) {
      this.logger('[Bob storage] Free-space preflight blocked operation', {
        source,
        availableBytes,
        requiredBytes: this.minimumBytes,
      });
      this._publishBlocked({source, transactionAttempted, availableBytes});
      throw this.createBlockedError();
    }

    return {ok: true, checked: true, availableBytes};
  }

  async retry(targetPath) {
    let availableBytes;
    try {
      availableBytes = await this.check(targetPath);
    } catch (error) {
      if (this.reportError(error, {source: 'status-check'})) {
        return {ok: false, availableBytes: null, requiredBytes: this.minimumBytes};
      }
      throw error;
    }

    if (availableBytes != null && availableBytes >= this.minimumBytes) {
      this.status = null;
      this.dispatch({type: STORAGE_CLEARED});
      return {ok: true, availableBytes, requiredBytes: this.minimumBytes};
    }

    this._publishBlocked({source: 'status-check', availableBytes});
    return {ok: false, availableBytes, requiredBytes: this.minimumBytes};
  }

  createBlockedError() {
    const error = new Error('Bob cannot continue because your device is low on storage.');
    error.code = STORAGE_BLOCKED_ERROR_CODE;
    return error;
  }
}

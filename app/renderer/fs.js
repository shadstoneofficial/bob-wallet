const files = window.bobElectron.files;
import {Buffer} from 'buffer';

function normalizeReadResult(data, encoding) {
  if (encoding || typeof data === 'string' || data == null) return data;
  return Buffer.from(data);
}

function withCallback(promise, callback) {
  if (typeof callback !== 'function') return promise;
  promise.then(data => callback(null, data)).catch(error => callback(error));
}

export function readFileSync(path, encoding) {
  return normalizeReadResult(files.readFileSync(path, encoding), encoding);
}

export function readFile(path, encoding, callback) {
  if (typeof encoding === 'function') {
    return withCallback(files.readFile(path).then(data => normalizeReadResult(data)), encoding);
  }
  return withCallback(
    files.readFile(path, encoding).then(data => normalizeReadResult(data, encoding)),
    callback,
  );
}

export function writeFile(path, data, callback) {
  return withCallback(files.writeFile(path, data), callback);
}

export const promises = {
  readFile(path, encoding) {
    return files.readFile(path, encoding).then(data => normalizeReadResult(data, encoding));
  },
  writeFile: files.writeFile,
};

export default {readFileSync, readFile, writeFile, promises};

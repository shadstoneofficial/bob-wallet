import BigNumber from 'bignumber.js';
import {translateEnglish} from './localeText';
import punycode from 'punycode';
import {verifyName} from 'hsd/lib/covenants/rules';

export const BASKET_DRAFT_VERSION = 1;
export const BASKET_LIMIT = 20;

const HEADER_NAMES = new Set(['name', 'domain', 'tld']);
const HEADER_BIDS = new Set(['true_bid', 'truebid', 'bid', 'true bid']);
const HEADER_BLINDS = new Set(['blind', 'blind_amount', 'blindamount', 'blind amount']);

export function normalizeBasketName(value) {
  let name = String(value || '').trim().toLowerCase();
  name = name.replace(/\/+$/, '').replace(/\.hns$/i, '');
  try {
    name = punycode.toASCII(name);
  } catch (error) {
    return '';
  }
  return name;
}

function parseAmount(value, label, t) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return {error: t('basketAmountRequired', label)};
  if (/^-/.test(raw)) return {error: t('basketAmountNegative', label)};
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return {error: t('basketAmountMalformed', label)};
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
  if (decimals > 6) return {error: t('basketAmountPrecision', label)};
  const amount = new BigNumber(raw);
  if (!amount.isFinite()) return {error: t('basketAmountMalformed', label)};
  return {value: amount.toFixed()};
}

function cellsForLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (trimmed.includes('|')) {
    return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  }
  if (trimmed.includes('\t')) return trimmed.split('\t').map(cell => cell.trim());
  if (trimmed.includes(',')) return trimmed.split(',').map(cell => cell.trim());
  return trimmed.split(/\s+/).map(cell => cell.trim());
}

function isMarkdownSeparator(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function isHeader(cells) {
  if (cells.length < 3) return false;
  return HEADER_NAMES.has(cells[0].toLowerCase())
    && HEADER_BIDS.has(cells[1].toLowerCase().replace(/-/g, '_'))
    && HEADER_BLINDS.has(cells[2].toLowerCase().replace(/-/g, '_'));
}

export function parseCompleteBasket(text, limit = BASKET_LIMIT, t = translateEnglish) {
  const parsed = [];
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((line, index) => {
    const cells = cellsForLine(line);
    if (!cells.length || isMarkdownSeparator(cells) || isHeader(cells)) return;

    const row = {
      rowNumber: index + 1,
      source: line,
      name: normalizeBasketName(cells[0]),
      bidAmount: '',
      blindAmount: '',
      lockupAmount: '',
      errors: [],
    };

    if (cells.length !== 3) {
      row.errors.push(t('basketImportColumns'));
    }
    if (!row.name || !verifyName(row.name)) row.errors.push(t('basketImportInvalidName'));

    const bid = parseAmount(cells[1], t('basketTrueBid'), t);
    const blind = parseAmount(cells[2], t('basketBlind'), t);
    if (bid.error) row.errors.push(bid.error);
    else row.bidAmount = bid.value;
    if (blind.error) row.errors.push(blind.error);
    else row.blindAmount = blind.value;

    if (!bid.error && !blind.error) {
      const lockup = new BigNumber(bid.value).plus(blind.value);
      if (lockup.isZero()) row.errors.push(t('basketImportZeroAmounts'));
      row.lockupAmount = lockup.toFixed();
    }
    parsed.push(row);
  });

  const counts = new Map();
  parsed.forEach(row => {
    if (row.name) counts.set(row.name, (counts.get(row.name) || 0) + 1);
  });
  parsed.forEach((row, index) => {
    if (row.name && counts.get(row.name) > 1) row.errors.push(t('basketImportDuplicate'));
    if (index >= limit) row.errors.push(t('basketLimitReached', String(limit)));
  });

  return parsed;
}

export function basketRowsFromState(order = [], items = {}) {
  return order.map(name => ({
    name,
    bidAmount: String(items[name]?.bidAmount || ''),
    blindAmount: String(items[name]?.blindAmount || ''),
    note: String(items[name]?.note || ''),
  }));
}

export function basketToCSV(order = [], items = {}) {
  const lines = ['name,true_bid,blind'];
  for (const row of basketRowsFromState(order, items)) {
    lines.push(`${row.name},${row.bidAmount || '0'},${row.blindAmount || '0'}`);
  }
  return `${lines.join('\n')}\n`;
}

export function splitBasket(order = [], items = {}, size = BASKET_LIMIT) {
  const batchSize = [5, 10, 20].includes(Number(size)) ? Number(size) : BASKET_LIMIT;
  const rows = basketRowsFromState(order, items);
  const batches = [];
  for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize));
  return batches;
}

export function serializeBasketDraft({walletId, network, order, items, formState = {}}) {
  return JSON.stringify({
    version: BASKET_DRAFT_VERSION,
    walletId: walletId || '',
    network: network || '',
    savedAt: Date.now(),
    rows: basketRowsFromState(order, items),
    formState: {
      step: formState.step === 'review' ? 'review' : 'edit',
      broadcastUncertain: !!formState.broadcastUncertain,
      submissionTxid: String(formState.submissionTxid || ''),
      submissionError: String(formState.submissionError || ''),
      submissionFailedStage: String(formState.submissionFailedStage || ''),
    },
  });
}

export function parseBasketDraft(raw, {walletId, network} = {}) {
  const draft = JSON.parse(raw || 'null');
  if (!draft || draft.version !== BASKET_DRAFT_VERSION || !Array.isArray(draft.rows)) return null;
  if (walletId && draft.walletId && draft.walletId !== walletId) return null;
  if (network && draft.network && draft.network !== network) return null;
  const rows = draft.rows.slice(0, BASKET_LIMIT).map(row => ({
    name: normalizeBasketName(row.name),
    bidAmount: String(row.bidAmount || ''),
    blindAmount: String(row.blindAmount || ''),
    note: String(row.note || ''),
  })).filter(row => row.name && verifyName(row.name));
  return {...draft, rows};
}

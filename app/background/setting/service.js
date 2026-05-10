import { del, get, put } from '../db/service';
import { app } from "electron";
import {
  getLiquiditySpotChannelUrl,
  normalizeLiquiditySpotHost,
} from '../../constants/liquiditySpotChannels';

const EXPLORER = 'setting/explorer';
const LOCALE = 'setting/locale';
const CUSTOM_LOCALE = 'setting/customLocale';


export async function getExplorer() {
  const explorer = await get(EXPLORER);
  return explorer;
}

export async function setExplorer(explorer) {
  return await put(EXPLORER, explorer);
}

export async function getLocale() {
  const locale = await get(LOCALE);

  if (locale) return locale;

  return app.getLocale();
}

export async function getCustomLocale() {
  return await get(CUSTOM_LOCALE);
}

export async function setLocale(locale) {
  await put(CUSTOM_LOCALE, '');
  return await put(LOCALE, locale);
}

export async function setCustomLocale(json) {
  await put(LOCALE, 'custom');
  return await put(CUSTOM_LOCALE, JSON.stringify(json));
}

export async function getLatestRelease() {
  try {
    const releases = await (
      await fetch(
        'https://api.github.com/repos/kyokan/bob-wallet/releases'
      )
    ).json();
    const latest = releases.filter(r => !r.draft && !r.prerelease)[0];
    return latest;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function validateLiquidityChannelHost(host) {
  const normalizedHost = normalizeLiquiditySpotHost(host);
  if (!normalizedHost) {
    return {
      ok: false,
      host: '',
      url: '',
      error: 'Enter a valid Liquidity channel host.',
    };
  }

  const url = getLiquiditySpotChannelUrl(normalizedHost);

  try {
    const resp = await fetch(url, {method: 'GET'});
    return {
      ok: resp.ok,
      host: normalizedHost,
      url,
      status: resp.status,
      error: resp.ok ? null : `HTTP ${resp.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      host: normalizedHost,
      url,
      error: e.message,
    };
  }
}

const sName = 'Setting';
const methods = {
  getExplorer,
  setExplorer,
  getLocale,
  setLocale,
  getCustomLocale,
  setCustomLocale,
  getLatestRelease,
  validateLiquidityChannelHost,
};

export async function start(server) {
  server.withService(sName, methods);
}

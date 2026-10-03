import semver from 'semver';
import {normalizeLocale} from '../utils/i18n';
const pkg = require('../../package.json');
import settingsClient from "../utils/settingsClient";
import hip2Client from '../utils/hip2Client';
import { SET_HIP2_PORT } from "./hip2Reducer";

const SET_DEEPLINK = 'app/setDeeplink';
const SET_LOCALE = 'app/setLocale';
const SET_CUSTOM_LOCALE = 'app/setCustomLocale';
const SET_DEEPLINK_PARAMS = 'app/setDeeplinkParams';
const SET_UPDATE_AVAILABLE = 'app/setUpdateAvailable';
const SET_THEME = 'app/setTheme';
const SET_SHOW_USD_VALUE = 'app/setShowUsdValue';

const initialState = {
  deeplink: '',
  deeplinkParams: {},
  locale: '',
  customLocale: null,
  theme: 'light',
  showUsdValue: true,
  updateAvailable: null,
};

export const checkForUpdates = () => async (dispatch) => {
  const latestRelease = await settingsClient.getLatestRelease();
  if (!latestRelease) return;

  const canUpdate = semver.gt(latestRelease.tag_name.replace(/$v/i, ''), pkg.version);
  if (canUpdate) {
    dispatch({
      type: SET_UPDATE_AVAILABLE,
      payload: {
        version: latestRelease.tag_name,
        url: `https://github.com/kyokan/bob-wallet/releases/tag/${latestRelease.tag_name}`,
      },
    });
  }
};

export const initHip2 = () => async (dispatch) => {
  dispatch({
    type: SET_HIP2_PORT,
    payload: await hip2Client.getPort()
  })
}

// Serialize Settings/header writes and prevent late startup reads replacing a choice.
let localeRevision = 0;
let localeWrite = Promise.resolve();
function queueLocaleWrite(write) {
  localeRevision++;
  const result = localeWrite.then(write);
  localeWrite = result.catch(() => {});
  return result;
}
const validCustomLocale = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value).every(text => typeof text === 'string');

export const fetchLocale = () => async dispatch => {
  const revision = localeRevision;
  let locale = 'en-US';
  let custom = null;
  try {
    await localeWrite;
    const saved = await settingsClient.getLocale();
    const raw = await settingsClient.getCustomLocale();
    if (saved === 'custom' && raw) {
      const parsed = JSON.parse(raw);
      if (validCustomLocale(parsed)) custom = parsed;
    }
    locale = custom ? 'custom' : normalizeLocale(saved);
  } catch (_) {
    // Missing/corrupt preferences must not leave the login language blank.
  }
  if (revision !== localeRevision) return;
  dispatch({type: SET_CUSTOM_LOCALE, payload: custom});
  dispatch({type: SET_LOCALE, payload: locale});
};

export const fetchTheme = () => async dispatch => {
  const theme = await settingsClient.getTheme();
  dispatch({
    type: SET_THEME,
    payload: theme,
  });
};

export const fetchShowUsdValue = () => async dispatch => {
  const showUsdValue = await settingsClient.getShowUsdValue();
  dispatch({
    type: SET_SHOW_USD_VALUE,
    payload: showUsdValue,
  });
};

export const setLocale = locale => dispatch => queueLocaleWrite(async () => {
  const next = normalizeLocale(locale);
  await settingsClient.setLocale(next);
  dispatch({type: SET_CUSTOM_LOCALE, payload: null});
  dispatch({type: SET_LOCALE, payload: next});
});

export const setCustomLocale = json => dispatch => {
  if (!json) {
    dispatch({type: SET_CUSTOM_LOCALE, payload: null});
    return Promise.resolve();
  }
  return queueLocaleWrite(async () => {
    if (!validCustomLocale(json)) throw new Error('Invalid custom locale JSON');
    await settingsClient.setCustomLocale(json);
    dispatch({type: SET_CUSTOM_LOCALE, payload: json});
    dispatch({type: SET_LOCALE, payload: 'custom'});
  });
};

export const setTheme = theme => async dispatch => {
  const nextTheme = await settingsClient.setTheme(theme);
  dispatch({
    type: SET_THEME,
    payload: nextTheme,
  });
};

export const setShowUsdValue = showUsdValue => async dispatch => {
  const nextShowUsdValue = await settingsClient.setShowUsdValue(showUsdValue);
  dispatch({
    type: SET_SHOW_USD_VALUE,
    payload: nextShowUsdValue,
  });
};

export const setDeeplink = url => ({
  type: SET_DEEPLINK,
  payload: url,
});

export const clearDeeplink = () => ({
  type: SET_DEEPLINK,
  payload: '',
});

export const setDeeplinkParams = params => ({
  type: SET_DEEPLINK_PARAMS,
  payload: params,
});

export const clearDeeplinkParams = () => ({
  type: SET_DEEPLINK_PARAMS,
  payload: {},
});

export default function appReducer(state = initialState, action) {
  switch (action.type) {
    case SET_DEEPLINK:
      return {
        ...state,
        deeplink: action.payload,
      };
    case SET_DEEPLINK_PARAMS:
      return {
        ...state,
        deeplinkParams: action.payload,
      };
    case SET_LOCALE:
      return {
        ...state,
        locale: action.payload,
      };
    case SET_CUSTOM_LOCALE:
      return {
        ...state,
        customLocale: action.payload,
      };
    case SET_THEME:
      return {
        ...state,
        theme: action.payload,
      };
    case SET_SHOW_USD_VALUE:
      return {
        ...state,
        showUsdValue: action.payload,
      };
    case SET_UPDATE_AVAILABLE:
      return {
        ...state,
        updateAvailable: action.payload,
      };
    default:
      return state;
  }
}

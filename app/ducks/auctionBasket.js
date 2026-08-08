const ADD_NAMES = 'app/auctionBasket/addNames';
const REMOVE_NAME = 'app/auctionBasket/removeName';
const UPDATE_ITEM = 'app/auctionBasket/updateItem';
const CLEAR_BASKET = 'app/auctionBasket/clearBasket';
const SET_STATUS = 'app/auctionBasket/setStatus';

export const AUCTION_BASKET_LIMIT = 20;

const initialState = {
  // { [name]: { name, bidAmount, blindAmount, note } }
  // bidAmount/blindAmount are HNS display strings for inputs
  items: {},
  order: [],
  lastError: '',
};

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\.\/$/, '')
    .replace(/\/$/, '');
}

export const addNamesToBasket = (names = []) => (dispatch, getState) => {
  const list = (Array.isArray(names) ? names : [names])
    .map(normalizeName)
    .filter(Boolean);

  if (!list.length) {
    return { added: 0, skipped: 0, limited: false };
  }

  const { order, items } = getState().auctionBasket;
  const remaining = Math.max(0, AUCTION_BASKET_LIMIT - order.length);
  let added = 0;
  let skipped = 0;
  let limited = false;
  const nextNames = [];

  for (const name of list) {
    if (items[name] || nextNames.includes(name)) {
      skipped += 1;
      continue;
    }
    if (added >= remaining) {
      limited = true;
      skipped += 1;
      continue;
    }
    nextNames.push(name);
    added += 1;
  }

  if (nextNames.length) {
    dispatch({
      type: ADD_NAMES,
      payload: nextNames,
    });
  }

  return { added, skipped, limited };
};

export const removeFromBasket = (name) => ({
  type: REMOVE_NAME,
  payload: normalizeName(name),
});

export const updateBasketItem = (name, patch) => ({
  type: UPDATE_ITEM,
  payload: {
    name: normalizeName(name),
    patch: patch || {},
  },
});

export const clearBasket = () => ({
  type: CLEAR_BASKET,
});

export const setBasketError = (message) => ({
  type: SET_STATUS,
  payload: { lastError: message || '' },
});

export default function auctionBasketReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    case ADD_NAMES: {
      const items = { ...state.items };
      const order = [...state.order];
      for (const name of payload) {
        if (items[name] || order.length >= AUCTION_BASKET_LIMIT) {
          continue;
        }
        items[name] = {
          name,
          bidAmount: '',
          blindAmount: '',
          note: '',
        };
        order.push(name);
      }
      return {
        ...state,
        items,
        order,
        lastError: '',
      };
    }
    case REMOVE_NAME: {
      if (!state.items[payload]) {
        return state;
      }
      const items = { ...state.items };
      delete items[payload];
      return {
        ...state,
        items,
        order: state.order.filter((n) => n !== payload),
      };
    }
    case UPDATE_ITEM: {
      const { name, patch } = payload;
      if (!state.items[name]) {
        return state;
      }
      return {
        ...state,
        items: {
          ...state.items,
          [name]: {
            ...state.items[name],
            ...patch,
            name,
          },
        },
      };
    }
    case CLEAR_BASKET:
      return {
        ...initialState,
      };
    case SET_STATUS:
      return {
        ...state,
        ...payload,
      };
    default:
      return state;
  }
}

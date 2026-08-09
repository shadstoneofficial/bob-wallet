const ADD_NAMES = 'app/openBasket/addNames';
const REMOVE_NAME = 'app/openBasket/removeName';
const CLEAR_BASKET = 'app/openBasket/clearBasket';

export const OPEN_BASKET_LIMIT = 20;

const initialState = {
  // { [name]: { name } }
  items: {},
  order: [],
};

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\.\/$/, '')
    .replace(/\/$/, '');
}

export const addNamesToOpenBasket = (names = []) => (dispatch, getState) => {
  const list = (Array.isArray(names) ? names : [names])
    .map(normalizeName)
    .filter(Boolean);

  if (!list.length) {
    return { added: 0, skipped: 0, limited: false };
  }

  const { order, items } = getState().openBasket;
  const remaining = Math.max(0, OPEN_BASKET_LIMIT - order.length);
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

export const removeFromOpenBasket = (name) => ({
  type: REMOVE_NAME,
  payload: normalizeName(name),
});

export const clearOpenBasket = () => ({
  type: CLEAR_BASKET,
});

export default function openBasketReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    case ADD_NAMES: {
      const items = { ...state.items };
      const order = [...state.order];
      for (const name of payload) {
        if (items[name] || order.length >= OPEN_BASKET_LIMIT) {
          continue;
        }
        items[name] = { name };
        order.push(name);
      }
      return {
        ...state,
        items,
        order,
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
    case CLEAR_BASKET:
      return { ...initialState };
    default:
      return state;
  }
}

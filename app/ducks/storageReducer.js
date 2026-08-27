export const STORAGE_BLOCKED = 'app/storage/blocked';
export const STORAGE_CLEARED = 'app/storage/cleared';

export function getInitialState() {
  return {
    blocked: false,
    transactionAttempted: false,
    availableBytes: null,
    requiredBytes: null,
    checkedAt: null,
    source: null,
  };
}

export default function storageReducer(state = getInitialState(), {type, payload}) {
  switch (type) {
    case STORAGE_BLOCKED:
      return {
        ...state,
        ...payload,
        blocked: true,
        transactionAttempted: state.transactionAttempted || !!payload.transactionAttempted,
      };
    case STORAGE_CLEARED:
      return getInitialState();
    default:
      return state;
  }
}

import { history, store } from '../../store/configureStore';
import {setDeeplinkParams} from "../../ducks/app";
import traceDeeplink from '../../utils/deeplinkTrace';

export default message => {
  const url = new URL(message);
  const params = url.searchParams;
  const name = params.get('name');
  const presignJSONString = params.get('presign');
  traceDeeplink('renderer-fulfillauction', {
    name,
    hasPresign: Boolean(presignJSONString),
    presignLength: presignJSONString ? presignJSONString.length : 0,
    beforePath: history.location && history.location.pathname,
  });

  if (presignJSONString) {
    store.dispatch(setDeeplinkParams({
      presignJSONString,
      name,
      openedAt: Date.now(),
    }));
  }

  if (presignJSONString || name) {
    history.push(`/exchange`);
    traceDeeplink('renderer-fulfillauction-push-exchange', {
      name,
      afterPath: history.location && history.location.pathname,
    });
  }
};

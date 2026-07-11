import { history, store } from '../../store/configureStore';
import { setDeeplinkParams } from '../../ducks/app';
import { getSafeLiquidityIntentUrl } from '../../utils/urlPolicy';

export default message => {
  const url = new URL(message);
  const intentUrl = getSafeLiquidityIntentUrl(url.searchParams.get('intent'));

  if (intentUrl) {
    store.dispatch(setDeeplinkParams({
      liquiditySwapIntentUrl: intentUrl,
      liquiditySwapReceivedAt: new Date().toISOString(),
    }));
  }

  history.push('/liquidity-swap');
};

import { configure } from 'enzyme';
import Adapter from '@cfaester/enzyme-adapter-react-18';

configure({ adapter: new Adapter() });

require('./app/pages/Auction/tests/RepairBid.spec');
require('./app/pages/MyDomain/tests/Records.spec');
require('./app/background/wallet/tests/liquidityHtlc.spec');

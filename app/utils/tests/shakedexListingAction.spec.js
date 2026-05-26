import test from 'tape';
import { LISTING_STATUS } from '../../constants/exchange';
import {
  isListingProofReadyForSubmission,
  isSellerListingNeedsAction,
} from '../shakedex';

test('seller listing needs action includes local proof ready for submission', (t) => {
  const listing = {
    status: LISTING_STATUS.ACTIVE,
    auction: { name: 'xn--ezi' },
    marketSubmission: null,
  };

  t.equal(isListingProofReadyForSubmission(listing), true);
  t.equal(isSellerListingNeedsAction(listing), true);
  t.end();
});

test('seller listing needs action excludes already submitted active proofs', (t) => {
  const listing = {
    status: LISTING_STATUS.ACTIVE,
    auction: { name: 'xn--ezi' },
    marketSubmission: { submittedAt: Date.now() },
  };

  t.equal(isListingProofReadyForSubmission(listing), false);
  t.equal(isSellerListingNeedsAction(listing), false);
  t.end();
});

test('seller listing needs action keeps lock/finalize action states', (t) => {
  t.equal(isSellerListingNeedsAction({
    status: LISTING_STATUS.TRANSFER_CONFIRMED,
  }), true);
  t.equal(isSellerListingNeedsAction({
    status: LISTING_STATUS.FINALIZE_CONFIRMED,
  }), true);
  t.equal(isSellerListingNeedsAction({
    status: LISTING_STATUS.CANCEL_CONFIRMED,
  }), true);
  t.end();
});

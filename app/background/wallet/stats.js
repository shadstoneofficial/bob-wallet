const { states } = require("hsd/lib/covenants/namestate");
const https = require("https");

const MAINNET = "main";
const nameValueCache = new Map();

/** @param {import('hsd/lib/wallet/wallet')} wallet */
async function fromBids(wallet) {
  const height = wallet.wdb.height;
  const network = wallet.network;

  // Live Auctions
  let biddingHNS = 0;
  let biddingNum = 0;

  // In Reveals
  let revealingHNS = 0;
  let revealingNum = 0;

  // Actionable
  let revealableHNS = 0;
  let revealableNum = 0;
  let revealableBlock = null;

  // All bids
  const bids = await wallet.getBids();

  for (let bid of bids) {
    // Don't bother if not own bid
    if (!bid.own) {
      continue;
    }

    const blind = bid.lockup - bid.value;
    const ns = await wallet.getNameState(bid.nameHash);
    const state = ns.state(height, network);

    // Only consider bids from the latest auction (is local?)
    const bidTx = await wallet.getTX(bid.prevout.hash);
    if (bidTx.height < ns.height) {
      continue;
    }

    // Full bid + blind is locked up in the bidding phase
    if (state === states.BIDDING) {
      biddingNum++;
      biddingHNS += bid.lockup;
      continue;
    }

    // Only care about auctions in REVEAL and CLOSED
    if (state !== states.REVEAL && state !== states.CLOSED) {
      continue;
    }

    // If in reveal, first assume that the bid is not yet revealed and the whole amount is locked up
    // Subtract later if a reveal is found
    if (state === states.REVEAL) {
      revealingHNS += bid.lockup;
      revealingNum++;
    }

    const bidCoin = await wallet.getUnspentCoin(bid.prevout.hash, bid.prevout.index);
    const isRevealed = !bidCoin;

    // If bid not yet revealed and is in reveal period
    if (!isRevealed) {
      if (state === states.REVEAL) {
        revealableHNS += blind;
        revealableNum++;
        const stats = ns.toStats(height, network);
        if (
          revealableBlock === null ||
          stats.blocksUntilClose < revealableBlock
        ) {
          revealableBlock = stats.blocksUntilClose;
        }
      }
      continue;
    }

    // At this point, the bid is revealed (at least)
    // If still in reveal period, the blind is no longer locked
    if (state === states.REVEAL) {
      revealingHNS -= blind;
      continue;
    }
  }

  return {
    bidding: { HNS: biddingHNS, num: biddingNum },
    revealing: { HNS: revealingHNS, num: revealingNum },
    revealable: {
      HNS: revealableHNS,
      num: revealableNum,
      block: revealableBlock,
    },
  };
}

/** @param {import('hsd/lib/wallet/wallet')} wallet */
export async function fromReveals(wallet) {
  const height = wallet.wdb.height;
  const network = wallet.network;

  let redeemableHNS = 0;
  let redeemableNum = 0;

  // All reveals
  const reveals = await wallet.getReveals();

  for (let reveal of reveals) {
    const ns = await wallet.getNameState(reveal.nameHash);

    if (!ns) {
      continue;
    }

    if (ns.isExpired(height, network)) {
      continue;
    }

    const state = ns.state(height, network);

    if (state < states.CLOSED) {
      continue;
    }

    if (!reveal.own) {
      continue;
    }

    if (reveal.prevout.equals(ns.owner)) {
      continue;
    }

    const revealCoin = await wallet.getUnspentCoin(
      reveal.prevout.hash,
      reveal.prevout.index
    );

    if (!revealCoin) {
      continue;
    }

    // Is local?
    if (revealCoin.height < ns.height) {
      continue;
    }

    redeemableHNS += revealCoin.value;
    redeemableNum++;
  }

  return {
    redeemable: { HNS: redeemableHNS, num: redeemableNum },
  };
}

/** @param {import('hsd/lib/wallet/wallet')} wallet */
async function fromNames(wallet) {
  const height = wallet.wdb.height;
  const network = wallet.network;

  let transferringDomains = new Set();
  let transferringBlock = null;
  let finalizableDomains = new Set();
  let renewableDomains = new Set();
  let renewableBlock = null;
  let registerableHNS = 0;
  let registerableNum = 0;
  let registerableVerified = true;

  const names = await wallet.getNames();

  for (let ns of names) {
    const name = ns.name.toString("utf-8");
    const stats = ns.toStats(height, network);

    const ownerCoin = await wallet.getUnspentCoin(ns.owner.hash, ns.owner.index);

    // Only act on currently owned names
    if (!ownerCoin) {
      continue;
    }

    if (ns.isExpired(height, network)) {
      continue;
    }

    // Registerable names
    if (ownerCoin.covenant.isReveal() || ownerCoin.covenant.isClaim()) {
      if (
        !ownerCoin.covenant.isClaim() ||
        height >= ownerCoin.height + network.coinbaseMaturity
      ) {
        if (ns.state(height, network) === states.CLOSED) {
          const verifiedValue = await getVerifiedNameValue(name, network);

          if (verifiedValue === null) {
            registerableVerified = false;
          }

          registerableHNS += ns.highest - (verifiedValue || ns.value);
          registerableNum++;
          continue;
        }
      }
    }

    // Mark for renew if the name is going to expire in the next 3 months:
    // About 90 days on main (1.75 years after REGISTER)
    // 625 blocks on regtest (4375 blocks after REGISTER)
    if (stats.blocksUntilExpire < network.names.renewalWindow / 8) {
      const isRenewable =
        ns.registered &&
        ns.transfer === 0 &&
        ns.renewal + network.names.treeInterval <= height;
      if (isRenewable) {
        renewableDomains.add(name);
        if (
          renewableBlock === null ||
          stats.blocksUntilExpire < renewableBlock
        ) {
          renewableBlock = stats.blocksUntilExpire;
        }
      }
    }

    // Names being transferred?
    if (ns.transfer !== 0) {
      // Either finalizable now, or not
      if (stats.blocksUntilValidFinalize <= 0) {
        finalizableDomains.add(name);
      } else {
        transferringDomains.add(name);
        if (
          transferringBlock === null ||
          stats.blocksUntilValidFinalize < transferringBlock
        ) {
          transferringBlock = stats.blocksUntilValidFinalize;
        }
      }
    }
  }

  return {
    registerable: {
      HNS: registerableHNS,
      num: registerableNum,
      verified: registerableVerified,
    },
    renewable: {
      domains: [...renewableDomains],
      block: renewableBlock,
    },
    transferring: {
      domains: [...transferringDomains],
      block: transferringBlock,
    },
    finalizable: { domains: [...finalizableDomains] },
  };
}

async function getVerifiedNameValue(name, network) {
  if (network.type !== MAINNET) {
    return null;
  }

  if (nameValueCache.has(name)) {
    return nameValueCache.get(name);
  }

  try {
    const html = await fetchShakeshiftNamePage(name);
    const match = html.match(/<span>Name Value<\/span>\s*<span[^>]*data-value="(\d+)"/);
    const value = match ? Number(match[1]) : null;
    const safeValue = Number.isSafeInteger(value) && value > 0 ? value : null;

    nameValueCache.set(name, safeValue);
    return safeValue;
  } catch (e) {
    console.warn(`Could not verify final auction value for ${name}/ while calculating register estimate:`, e.message);
    nameValueCache.set(name, null);
    return null;
  }
}

function fetchShakeshiftNamePage(name) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://shakeshift.com/name/${encodeURIComponent(name)}`,
      {timeout: 4000},
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Shakeshift returned HTTP ${res.statusCode}`));
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 500000)
            req.destroy(new Error('Shakeshift response was too large.'));
        });
        res.on('end', () => resolve(body));
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('Timed out while verifying auction price.'));
    });
    req.on('error', reject);
  });
}

/** @param {import('hsd/lib/wallet/wallet')} wallet */
export async function getStats(wallet) {
  const [statsFromBids, statsFromReveals, statsFromNames] = await Promise.all([
    fromBids(wallet),
    fromReveals(wallet),
    fromNames(wallet),
  ]);

  return {
    lockedBalance: {
      bidding: {
        HNS:
          statsFromBids.bidding.HNS +
          statsFromBids.revealing.HNS -
          statsFromBids.revealable.HNS,
        num: statsFromBids.bidding.num + statsFromBids.revealing.num,
      },
      revealable: statsFromBids.revealable,
      finished: {
        HNS: statsFromNames.registerable.HNS + statsFromReveals.redeemable.HNS,
        num: statsFromNames.registerable.num + statsFromReveals.redeemable.num,
      },
    },
    actionableInfo: {
      revealable: statsFromBids.revealable,
      redeemable: statsFromReveals.redeemable,
      registerable: statsFromNames.registerable,
      renewable: statsFromNames.renewable,
      transferring: statsFromNames.transferring,
      finalizable: statsFromNames.finalizable,
    },
  };
}

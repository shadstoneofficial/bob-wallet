export function parseShakeshiftRegisterValue(html) {
  if (typeof html !== 'string')
    return null;

  const currentHeading = '<h2 id="auction">Auction Details</h2>';
  const currentAuctionDetailsIndex = html.indexOf(currentHeading);
  const auctionDetailsIndex = currentAuctionDetailsIndex !== -1
    ? currentAuctionDetailsIndex
    : html.indexOf('<h2>Auction Details</h2>');

  if (auctionDetailsIndex !== -1) {
    const nextHeadingIndex = html.indexOf('<h2', auctionDetailsIndex + 1);
    const auctionDetails = html.slice(
      auctionDetailsIndex,
      nextHeadingIndex === -1 ? html.length : nextHeadingIndex,
    );
    const result = findLabeledValue(auctionDetails, 'Result');

    if (result != null)
      return result;
  }

  const lifecycleValue = findLabeledValue(html, 'Lifecycle Value');
  if (lifecycleValue != null)
    return lifecycleValue;

  return findLabeledValue(html, 'Name Value');
}

function findLabeledValue(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<span>${escaped}<\\/span>[\\s\\S]{0,500}?data-value="(\\d+)"`,
  );
  const match = html.match(pattern);

  if (!match)
    return null;

  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

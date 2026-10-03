async function initializeAcceptanceAfterWindow({
  showMainWindow,
  seedFixture,
  publishReady,
}) {
  const firstWindow = showMainWindow();
  const fixture = await seedFixture();
  await publishReady(fixture);
  return firstWindow;
}

module.exports = {initializeAcceptanceAfterWindow};

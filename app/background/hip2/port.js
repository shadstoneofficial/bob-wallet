export function selectAliasResolverPort(storedPort, recursivePort) {
  return storedPort !== null ? storedPort : recursivePort;
}

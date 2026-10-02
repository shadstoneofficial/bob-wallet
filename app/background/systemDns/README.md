# Bob system DNS core prototype

This directory is a non-privileged prototype for Bob's proposed **Use Bob to
resolve Handshake names on this computer** feature. It is deliberately not
registered in `app/main.js`, does not edit operating-system DNS, and does not
install a service.

## Verified Bob inputs

The production integration should build its resolver context inside Bob's
trusted background process from the running Node service and Connections
service:

- connection type from `getConnection()` (`P2P` is eligible; `Custom` is not);
- node mode from `NodeService.getSpvMode()`;
- network, running state and chain state from the active Node service;
- internal DNS state from `NodeService.getNoDns()`; and
- the active recursive port from `NodeService.getRsPort()`.

Do not repeat `9892` in the new feature. The active checkout intentionally uses
`10892` under `BOB_LEARNHNS_TEST=true`, and future network or packaging changes
may alter the port again.

The readiness rule mirrors Bob's current SyncStatus logic: a peer-reported
height ahead of the local height is not ready; otherwise HSD `synced === true`
or progress of at least `0.99995` is ready. The DNS probes are an additional
requirement and must validate representative HNS, ICANN, DNSSEC and TCP paths.

## Trust boundary

```text
renderer / trusted Add-On facade
             |
             | narrow intent API; no raw arguments
             v
SystemDnsController in Bob's background process
             |
             | authenticated, versioned native protocol
             v
signed privileged helper (not implemented here)
             |
             +-- capture/apply/restore exact system DNS
             +-- bind UDP/TCP loopback port 53
             +-- forward only to Bob's published loopback recursive port
```

The future native helper must not accept arbitrary commands, paths, interface
names, resolver addresses or shell arguments from renderer or Add-On code. It
must authenticate the calling Bob application, own the integrity-protected
restore record, and expose only versioned operations equivalent to:

```text
preflight
capture
startBridge(loopbackBobPort)
applyCapturedDns(transactionId)
inspectOwnership(transactionId)
restore(transactionId)
status
```

The controller's current `platform` and `recordStore` dependencies represent
that future native boundary. Tests supply in-memory adapters only.

## Add-On-facing contract

Untrusted Add-Ons may receive only:

- `resolver.getStatus` — sanitized status, without ports, interface IDs or
  backup contents;
- `resolver.requestTest` — read-only core preflight;
- `resolver.requestEnable` — asks trusted Bob UI to confirm; and
- `resolver.requestDisable` — asks trusted Bob UI to confirm restoration.

Add-Ons never receive the helper handle, restore record, node API key, raw DNS
queries, interface configuration, or a way to claim that confirmation already
happened. The trusted Bob core owns the confirmation prompt and mutation.

This is an API proposal for the existing phased Add-On architecture, not a
plugin installer.

## Lifecycle policy for v1

- Normal quit: call `disable()` and wait for verified restoration before
  stopping the bridge and node.
- Failed enable: rollback the captured transaction before stopping the bridge.
- Crash or reboot: a signed helper/startup repair path reads the protected
  record and restores Bob-owned DNS; this prototype models it with
  `reconcileOnStartup()`.
- VPN, DHCP, MDM or manual DNS change: `inspectOwnership()` must refuse to
  overwrite configuration Bob no longer owns and report `needs-repair`.
- Node mode, network, internal-DNS or connection-mode change: disable and
  restore first; do not hot-swap the upstream while Bob owns system DNS.
- Custom RPC: unavailable in v1 because Bob does not own the remote resolver's
  lifecycle or a compatible local recursive endpoint.

## Prototype bridge

`LoopbackDnsBridge` forwards UDP and single-query TCP DNS on IPv4 loopback.
It refuses privileged listen ports and remote upstreams, and tests use only
ephemeral loopback ports plus a fake resolver. It demonstrates forwarding and
limits; it is not the signed dual-stack port-53 helper.

Run the isolated checks with:

```sh
node app/background/systemDns/tests/prototype.spec.cjs
```


# Bob local Handshake system DNS — development plan

Status: source-only development slice; disabled by default; no privileged helper is installed or run.

## Answer to the infrastructure question

Bob already starts an HSD recursive resolver for a local P2P connection in both
SPV and full-node modes. The feature must discover `NodeService.getRsPort()` and
forward to that loopback resolver. It therefore does **not** need another HNS
node, the Shakescape DigitalOcean node, the LearnHNS Market full node, or a new
public resolver service.

Those servers could operate an optional public resolver, but that is a different
product with abuse, privacy, availability and DNS amplification risk. The local
Bob design keeps DNS queries on the device and has an incremental hosting cost
of $0. Its costs are engineering, signing/notarization, release testing and user
support—not another droplet.

Custom RPC is not eligible in v1 because Bob does not own the remote resolver's
lifecycle and cannot safely infer a compatible local recursive endpoint.

## Current source slice

- The existing controller discovers Bob's active loopback recursive port and
  accepts mainnet local P2P SPV or full-node contexts only.
- A production-safe IPC service exposes `getStatus` and `test` only. It has no
  enable, disable, raw helper, path, interface or arbitrary resolver method.
- The Add-Ons card is compiled into development builds only when both
  `NODE_ENV != production` and `BOB_SYSTEM_DNS_DEV=true`. It reports sanitized
  status and can run read-only HNS, ICANN, DNSSEC and TCP checks.
- The DNS test client accepts loopback endpoints only, bounds timeouts, validates
  message identifiers and response flags, and retries a truncated UDP response
  over TCP. It does not log query names or response contents.
- The JavaScript controller journals before mutation, restores any owned stale
  transaction before a new enable, records a restoring phase, preserves exact
  DHCP/static/empty state, and stops on ambiguous ownership.
- A macOS 13 Swift package defines the versioned request/restore protocol and a
  dependency-injected recovery state machine. Its tests are non-privileged and
  use only in-memory mocks.

No source in this slice installs a daemon, binds port 53, edits System
Configuration, changes the machine's DNS, or exposes enable/disable in the UI.

## macOS helper decision

The planned implementation is a signed launch daemon embedded in Bob and
registered with `SMAppService.daemon(plistName:)`. Apple documents
`SMAppService` for bundled LaunchAgents and LaunchDaemons on macOS 13 and later,
with daemon activation subject to administrator approval:

- <https://developer.apple.com/documentation/servicemanagement/smappservice>
- <https://developer.apple.com/documentation/servicemanagement/smappservice/register()>
- <https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos>

Bob currently pins Electron 43. Electron's published breaking-change schedule
says macOS 12 remains supported through Electron 43 and macOS 13 becomes the
minimum at Electron 44. Therefore Bob's current application floor is macOS 12,
but the first system-DNS helper should be explicitly available on macOS 13+.
Bob must show “unsupported OS” on macOS 12; it must not silently use legacy
installation scripts or `SMJobBless` without a separate review.

DNS changes should use SystemConfiguration APIs, not `networksetup` or shell
commands. The helper must take an exclusive `SCPreferencesLock`, persist its
recovery journal before mutation, commit, apply, verify, then unlock. Apple
distinguishes persistent commit from applying to the active configuration:

- <https://developer.apple.com/documentation/systemconfiguration/scpreferences>
- Locking: <https://developer.apple.com/documentation/systemconfiguration/scpreferenceslock(_:_:)>.
- <https://developer.apple.com/documentation/systemconfiguration/scpreferencescommitchanges(_:)>

Before any privileged operation the daemon must validate the XPC peer's audit
identity and designated code-signing requirement against Bob's Team ID and
bundle identifier, validate protocol version and a single-use nonce, and accept
only fixed operations. The helper owns its root-readable, atomic recovery record.
It must never accept a shell command, file path, interface name, DNS server,
listen address or upstream host from the renderer.

## Failure and recovery matrix

| Event | Required behavior |
| --- | --- |
| Bob normal quit | Restore and verify exact prior DNS before bridge/node stop. |
| Bob or renderer crash | Daemon retains the journal and restores on its supervised recovery path. |
| Helper crash or reboot | Journal phases are replay-safe; restore happens before any new enable. |
| Partial apply | Roll back every captured service; keep journal if verification fails. |
| Pending-to-active journal write fails | Restore immediately; do not clear evidence until verified. |
| DHCP or adapter change | Re-enumerate stable service IDs; never substitute display names. |
| VPN/MDM/manual DNS change | Ownership mismatch stops automatic overwrite and reports repair needed. |
| Sleep/wake or network roam | Re-check ownership and resolver health; restore rather than hot-swap upstream. |
| Node stops, restarts or changes SPV/full mode | Restore system DNS first; a later explicit enable may use the new Bob port. |
| Connection changes to Custom RPC | Restore and mark unavailable. |
| Two Bob instances | Installation/transaction ownership and one serialized operation prevent takeover. |
| App/helper version mismatch | Reject protocol; retain recoverable journal and display repair state. |
| Add-On or renderer compromise | Only sanitized read-only IPC is reachable; no privileged operation exists there. |

## Remaining roadmap before a real toggle

1. Build the daemon/XPC targets in an Xcode project and implement atomic,
   permission-restricted storage plus SystemConfiguration capture/apply/restore.
2. Complete peer code-sign validation, replay protection, launchd supervision,
   helper upgrade/uninstall recovery and dual-stack UDP/TCP port-53 forwarding.
3. Add signed-app integration tests on disposable macOS 13+ VMs for Wi-Fi,
   Ethernet, DHCP/static/empty DNS, VPN, sleep/wake, reboot and crash boundaries.
4. Only after security review, add core-owned enable/disable confirmations. Keep
   the Add-On surface free of raw privileged controls.
5. Package, sign, notarize and release only through the existing Bob release
   process. This PR intentionally does none of those operations.

## Localization handoff

The UI uses existing locale lookup/fallback behavior. English adds these keys;
the Russian, Thai and Simplified Chinese locale owner should translate them in
their owned files before the development card graduates:

- `systemDnsDevelopmentStatus`
- `systemDnsDevelopmentDescription`
- `systemDnsResolverReady`
- `systemDnsResolverUnavailable`
- `systemDnsRunTest`

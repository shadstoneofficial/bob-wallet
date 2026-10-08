# Register All Partial Recovery

## Scope and Root Cause

The previous loop accumulated successful transaction IDs only in a local array.
A later preparation/signing failure rejected the whole call and discarded that
array from the renderer response. The caller could not distinguish already sent
names from names still awaiting registration. The shared transaction proxy also
started a wallet lock without awaiting completion, allowing that late lock to
race the next transaction's unlock.

This patch adds a wallet/network-scoped durable journal. Every name records its
stage, status, candidate transaction ID, and actual error. Broadcast intent is
persisted before network submission. Known preparation failures can resume after
eligibility is rechecked, excluding earlier submitted names. Unknown outcomes
remain locked across process restart; missing wallet history is not rejection
evidence. Only positive lookup of the exact candidate ID resolves uncertainty.

The Account and Your Bids pages use the same recovery component. A per-operation
ID supports Stop and unmount cancellation, including a cancellation received
before delayed submission. Wallet selection generations catch A-to-B-to-A
switches. The node's internal context guard runs synchronously after asynchronous
storage preflight and before sending. Cancellation does not undo sent transactions.

Wallet locks are awaited against the captured client and wallet ID. Cleanup
failure cannot replace an accepted transaction receipt or an ambiguous send error.
Preparation failures after unlock also attempt to relock the captured wallet.

## Source Verification

All tests use injected inert transport, mocks, or existing isolated fixtures:

- `npm test`: 1,301 Tape assertions, seven actual service/Node-method tests,
  and 59 packaged-harness source tests passed.
- `npm run build-renderer`: source compilation passed.
- Babel compilation of `app/background`: passed.
- Journal tests cover six successful names followed by a signing failure in a
  38-name operation, restart/resume of the remaining 32, exact-ID reconciliation,
  failed durable write, concurrency, and lost eligibility.
- Service tests execute actual service method bodies with injected I/O, not the
  real service singleton. They cover partial restart, ambiguous outcomes,
  cancellation during derivation, wallet switching, delayed IPC, relock ordering,
  preservation of accepted/unknown results, and delayed node preflight.
- Component tests cover duplicate clicks, late completion after unmount,
  retry-locked uncertainty, failed cancellation retry, bounded read-only status
  queries, and stale-wallet responses.

English, Simplified Chinese, Russian, and Thai UI labels were added. These are
AI translations, not native-speaker-reviewed text. Raw backend errors are retained
for diagnosis. Runtime wallet state is not used for these tests.

## Required Before Stable Release

This is source verification, NOT packaged Register All acceptance. No installer
was built or signed for this patch. No real wallet/profile, credentials, DNS
records, or live transactions were accessed or changed.

The packaged acceptance harness now includes `register-partial`,
`register-ambiguous`, and `register-cancel` scenarios. They exercise the real
RegisterAll component, Redux thunk, IPC, and RegisterAllJournal. The shared
WalletService proxy, construction, key derivation, signatures, and transport are
MOCKED, not the real wallet service. No fixture transaction ID represents a real
transaction. Source service tests separately exercise real method bodies with
injected I/O; this distinction must remain visible in acceptance reports.

The source renderer/IPC suite passes all 12 tests, including the three new
registration scenarios, negative context/credential/storage-policy checks, and
a real disposable database reopened in a new process with its uncertainty lock
intact. This does not establish that a signed package passes these tests.

Use the existing exact-path macOS launcher with a fresh disposable directory:

```sh
node scripts/launch-packaged-acceptance-macos.js '/exact/candidate/Bob LearnHNS.app' --profile-root '/new/disposable/register-partial' --initialize --scenario register-partial --accept-disposable-profile
```

For reopening that profile, replace `--initialize --scenario register-partial`
with `--reuse`. Use separate new directories for `register-ambiguous` and
`register-cancel`. Open "Fixed fixtures" (`/acceptance-fixtures`) in the isolated
app. No normal
wallet profile, credential, privileged helper, or external transaction service is
needed. The fixture reports `walletServiceProxy: MOCKED` and `transport: INERT`.

Before stable publication, rerun in the exact signed candidate and record:

1. Six accepted IDs followed by one preparation failure in a 38-name run.
2. Restart the same disposable profile; show six retained receipts and resume
   exactly 32 names, without recreating the first six.
3. The inert ambiguous response stays locked through restart and negative
   history. Positive exact-ID reconciliation remains covered by the source
   journal/service tests, not this deliberately negative-history fixture.
4. Stop and leave/return during delayed preparation send nothing afterward.
   A-to-B-to-A wallet switching is covered by source service tests, not this
   single-fixed-wallet fixture. A packaged multi-wallet registration test remains
   a separate acceptance gap; do not substitute a production profile.
5. Exercise narrow/wide light/dark recovery screens in all four languages,
   including long transaction IDs and errors.

Retain the harness's filesystem isolation and backend regtest-only restrictions;
do not replace these checks with manifest claims or use a production profile.
The fixture adapters replace only the three Register All methods for registration
scenarios. All three real methods remain blocked in other acceptance scenarios.
Renderer writes/deletes cannot alter the fixture journal or its counters.

## Limits

- Multisig Register All is explicitly blocked because its separate signing UI
  does not yet participate in this recovery journal. Individual registration is
  unchanged. Hardware-wallet behavior needs disposable packaged acceptance.
- A synchronous internal pre-send guard rejection proves no transport call
  occurred and permits safe resumption. Any other failure after durable broadcast
  intent remains uncertain until independent reconciliation; missing history is
  never treated as proof that retry is safe.
- Journal deletion/corruption, restoration of old application databases, or
  submissions from another application are outside duplicate-prevention guarantees.
- Existing individual registration or other transaction entry points are not
  globally locked by a Register All uncertainty record. Review wallet history
  before taking action through another flow.
- Native-language review and packaged acceptance remain unperformed here.

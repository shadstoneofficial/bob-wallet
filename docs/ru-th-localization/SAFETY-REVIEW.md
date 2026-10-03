# Separate AI wording review — 2026-10-03

Reviewer: the translation agent, in a deliberate second pass against the English source and UI call sites. This is not an independent agent or native-human review. The user's instruction permits AI-reviewed selectable locales after tests and review; native feedback is deferred, not claimed.

## Terminology

| Meaning | Russian | Thai |
|---|---|---|
| Seed/recovery phrase | секретная фраза восстановления | วลีกู้คืน |
| Private key | закрытый ключ | คีย์ส่วนตัว |
| Password | пароль | รหัสผ่าน |
| Construct transaction | создать транзакцию | สร้างธุรกรรม |
| Sign | подписать | ลงนาม |
| Broadcast | отправить в сеть | เผยแพร่สู่เครือข่าย |
| Chain confirmation | подтверждение в блокчейне | การยืนยันบนเชน |
| True bid | истинная ставка | ราคาเสนอประมูลจริง |
| Blind amount | маскирующая сумма | เงินพรางราคา |
| Lockup amount | заблокированная сумма | ยอดล็อก |
| Reveal bid | раскрыть ставку | เปิดเผยราคา |
| Redeem losing bid | вернуть ставку | รับเงินประมูลคืน |
| Register winning name | зарегистрировать имя | จดทะเบียนชื่อโดเมน |
| Transfer name | передать имя | โอนชื่อโดเมน |
| Finalize transfer | завершить передачу | ทำขั้นตอนสุดท้ายของการโอน |
| Display seed | показать секретную фразу | แสดงวลีกู้คืน |

## Review findings and disposition

- Corrected literal draft translations of blind as blindness, sign as a sign/label, broadcast as broadcasting media, and finalize as a summary. These are distinct wallet actions now.
- Checked `backup*`, `obBackupSeed*`, `obImport*`, `phraseMismatch*`, `removeWallet*`, `seedCopy*`, `revealSeed*`, and `settingAccountKey*`. Seed recovery does not promise restoration of settings/watchlists/market files. Password-encrypted key backups remain distinct from seed phrases and public account keys. Clipboard/phishing/loss warnings remain.
- Checked `multisig*`, `txView*`, `basket*Status/Help/Stage`, `storageError*`. M-of-N keeps M then N. Construction/signing say nothing has been sent; broadcasting/verifying do not. Uncertain failure does not assert safe retry. The rendered component tests keep retry disabled for uncertain outcomes and enabled only for proven pre-broadcast failure.
- Checked `bid*`, `blind*`, `basket*`, `openBasket*`, `reveal*`, `redeem*`, `register*`, `repairBid*`, `overviewAction*`. Bid + blind = lockup, blind is not a fee, OPEN is not BID, losing-bid redemption differs from winning-name registration, and reveal deadline/loss warnings remain. “Free to open” means available for auction, not zero cost.
- Checked `transfer*`, `finalize*`, `bulkFinalize*`, `shakedexStatus*`, `claimNamePayment*`. Submitting a transfer is not finalization. Recipient-address warnings retain the fact that the address is not the user's. Registration appears only after chain confirmation.
- Checked sale-proof/ShakeX and Addons notices. A price listing is not a signed offer; private proofs are usable by anyone holding them; old proofs may remain usable. Publishing/downloading a proof does not send an on-chain transaction. Catalog copy does not grant wallet permissions or claim atomic swaps are already implemented.
- Reviewed incoming `walletRescanWaiting` and `walletRescanFailed` separately in `pending-locale-tails.json`: waiting is not completion; failure says recovery is incomplete and restart resumes it. These are not yet runtime keys because PR #18 remains unmerged at the recorded baseline.
- Checked `%s` argument order in multi-value messages, dates/count labels, machine tokens and literal amounts. Numeric parsing was not localized. Historical educational text retains English-source meaning rather than silently changing protocol claims.

## Back-translation samples

These are reviewer back-translations into English, not another translation service's validation. Exact locale excerpts follow the table for independent orchestration review.

| Key | Russian back-translation | Thai back-translation |
|---|---|---|
| `obImportRestoreScope` | Import restores blockchain operations after scanning; not local settings, watchlists or market listing files. Keep the old app/backups until checked. | Seed/key import recovers on-chain activity after scanning, not local settings/watchlists/market files; retain the old app and backup until verified. |
| `obImportSeedWarningXpriv` | Enter extended private key; mainnet begins with xprv. | Enter the extended private key; on mainnet it starts with xprv. |
| `multisigPolicy` | Required: M of N signatures. | Requires signatures from M of N participants. |
| `basketSigningStatus` | Signing transaction — it has not yet been sent. | Signing the transaction — no transaction has been sent yet. |
| `basketRetryUncertain` | History could not prove the transaction was not sent; retry stays disabled to prevent a duplicate bid. | Wallet history cannot establish no transaction was sent; retry stays disabled to avoid bidding twice. |
| `blindTooltip` | Bid and masking amount form the only visible locked amount; all is locked during bidding; masking amount returns upon reveal whether won or lost. | True bid plus masking money is the visible locked amount; all is locked during bidding; masking money returns when revealed, win or lose. |
| `registerSuccess` | Registration transaction sent; shows registered after blockchain confirmation. | Registration transaction sent; status becomes registered after on-chain confirmation. |
| `transferInProgressWarningWithBlocks` | Transfer in progress; blocks until finalization is available: N. | Transfer underway; final step becomes available after N blocks. |
| `addonLiquidityExternalNotice` | Opens outside Bob; Bob will not share recovery phrase, private keys, wallet password or signing permissions. | Opens outside Bob; Bob sends no recovery phrase, private keys, wallet password or signing rights to this addon. |
| `walletRescanFailed` (pending) | Recovery incomplete. Restart Bob to continue. | Wallet recovery is not complete. Restart Bob to continue. |

## Exact reviewed excerpts

### `obImportRestoreScope`

English: Importing a seed or key restores on-chain wallet activity after scanning. It does not restore local settings, watchlists, or Marketplace listing files. Keep the old app and your Marketplace backups until you verify the restored wallet.

Russian: Импорт секретной фразы или ключа восстанавливает операции кошелька в блокчейне после сканирования. Локальные настройки, списки наблюдения и файлы предложений рынка не восстанавливаются. Сохраните старое приложение и резервные копии рынка до проверки восстановленного кошелька.

Thai: การนำเข้าวลีกู้คืนหรือคีย์จะกู้คืนกิจกรรมกระเป๋าเงินบนเชนหลังสแกนเสร็จ แต่จะไม่กู้คืนการตั้งค่าในเครื่อง รายการติดตาม หรือไฟล์ประกาศในตลาด โปรดเก็บแอปเดิมและข้อมูลสำรองของตลาดไว้จนกว่าจะตรวจสอบกระเป๋าเงินที่กู้คืนแล้ว

### `obImportSeedWarningXpriv`

English: Enter your extended private key. It starts with "xprv" on mainnet.

Russian: Введите расширенный закрытый ключ. В основной сети он начинается с «xprv».

Thai: กรอกคีย์ส่วนตัวแบบขยายของคุณ ในเครือข่ายหลักคีย์จะขึ้นต้นด้วย «xprv»

### `multisigPolicy`

English: Policy: %s-of-%s signatures required

Russian: Правило: требуется %s из %s подписей

Thai: เงื่อนไข: ต้องมีลายเซ็น %s จาก %s ราย

### `basketSigningStatus`

English: Signing transaction — no transaction has been sent.

Russian: Подписание транзакции — транзакция ещё не отправлена.

Thai: กำลังลงนามธุรกรรม — ยังไม่ได้ส่งธุรกรรม

### `basketRetryUncertain`

English: Wallet history could not prove that no transaction was sent. Retry remains disabled to prevent a duplicate bid.

Russian: По истории кошелька не удалось доказать, что транзакция не отправлялась. Повторная отправка остаётся отключённой, чтобы не сделать ставку дважды.

Thai: ประวัติกระเป๋าเงินไม่สามารถยืนยันได้ว่าไม่มีการส่งธุรกรรม จึงยังปิดการลองส่งอีกครั้งไว้เพื่อป้องกันการเสนอราคาซ้ำ

### `blindTooltip`

English: You can add a blind to your bid amount to cover up your actual bid. Your bid + blind is called lockup, which is the only value that other bidders see. The entire lockup will be frozen during the bidding period. The blind will be returned when it is revealed during the reveal period, whether you win the auction or not.

Russian: К ставке можно добавить маскирующую сумму, чтобы скрыть истинную ставку. Ставка и маскирующая сумма вместе образуют заблокированную сумму — только её видят другие участники. Вся сумма блокируется на период приёма ставок. Маскирующая сумма возвращается при раскрытии ставки в период раскрытия независимо от того, выиграли вы аукцион или нет.

Thai: คุณสามารถเพิ่มเงินพรางราคาเพื่อปิดบังราคาเสนอประมูลจริงได้ ราคาเสนอประมูลรวมกับเงินพรางราคาคือยอดล็อก ซึ่งเป็นยอดเดียวที่ผู้ประมูลคนอื่นเห็น ยอดทั้งหมดนี้จะถูกล็อกระหว่างช่วงเสนอราคา เงินพรางราคาจะคืนเมื่อคุณเปิดเผยราคาในช่วงเปิดเผยราคา ไม่ว่าคุณจะชนะการประมูลหรือไม่

### `registerSuccess`

English: Your register transaction was submitted. It will show as registered after it confirms on-chain.

Russian: Транзакция регистрации отправлена. Домен будет отображаться как зарегистрированный после подтверждения в блокчейне.

Thai: ส่งธุรกรรมจดทะเบียนแล้ว สถานะจะแสดงว่าจดทะเบียนแล้วหลังได้รับการยืนยันบนเชน

### `transferInProgressWarningWithBlocks`

English: Your transfer is in progress. You will be able to finalize the transfer in %s blocks.

Russian: Передача выполняется. До возможности её завершить осталось блоков: %s.

Thai: กำลังดำเนินการโอน คุณจะทำขั้นตอนสุดท้ายได้ในอีก %s บล็อก

### `addonLiquidityExternalNotice`

English: Liquidity opens outside Bob. Bob will not share your seed phrase, private keys, wallet password, or signing permissions with this Add On.

Russian: Liquidity открывается вне Bob. Bob не передаст этому дополнению секретную фразу восстановления, закрытые ключи, пароль кошелька или разрешения на подпись.

Thai: Liquidity จะเปิดนอก Bob โดย Bob จะไม่ส่งวลีกู้คืน คีย์ส่วนตัว รหัสผ่านกระเป๋าเงิน หรือสิทธิ์ลงนามให้ส่วนเสริมนี้

### Incoming recovery failure

Russian: Восстановление кошелька не завершено. Перезапустите Bob, чтобы продолжить.

Thai: การกู้คืนกระเป๋าเงินยังไม่เสร็จสมบูรณ์ เริ่ม Bob ใหม่เพื่อดำเนินการต่อ

### PR #13 read-only status wording

Separate AI check of the incoming five keys: Russian and Thai both say **development only**, check readiness of **Bob's local resolver**, and explicitly say the feature **cannot change system DNS**. Ready means ready for read-only checks, not enabled system DNS. Ineligible is kept as an eligibility statement, not a claim of a failed resolver. The button requests a resolver test, not activation. Exact translations are in `pending-locale-tails.json`; PR #13 implementation remains outside this localization branch.

Back-translations of `systemDnsDevelopmentDescription`:

- Russian: “Checks the readiness of Bob's local resolver. This function cannot change system DNS settings.”
- Thai: “Checks whether Bob's local resolver is ready, and cannot change the system DNS.”

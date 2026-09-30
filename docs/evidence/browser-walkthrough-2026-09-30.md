# Signed-in DisplayDeck walkthrough — 2026-09-30

Windows Edge, installed Genesis Trade Suite development preview, genuine Shopify session authentication and local persisted PGlite API. Internal synthetic ledger data only; no Shopify order/payment or physical POS outcome is claimed.

## Observed

- Posted synthetic ACC-001 external receipt `EFT-BROWSER-20260930-01` for ZAR 2000, allocated oldest-first. Net balance changed from 6300 to 4300.
- Reversed that allocation. Invoice remainder reopened at 2000 and unapplied credit became 2000; net remained 4300. [Reversal view](displaydeck-durable-reversal-2026-09-30.png).
- Fixed the accounts parent route so account detail pages render. Corrected persisted terms, contact and identity mappings; ACC-002 now displays Net 60 rather than a hardcoded Net 30.
- Completed onboarding currency/aging, defaults and completion actions. Preferences now persist per tenant, reject invalid currency/values and require manage_policy for updates. Omitted fields are retained. [Verification view](displaydeck-onboarding-verification-2026-09-30.png).
- Restarted combined API/preview using `.data/embedded-browser-demo`. ACC-001 still showed 4300 and onboarding resumed at saved step 4. [Accounts after restart](displaydeck-accounts-restart-2026-09-30.png).
- Pressed Left on focused onboarding step 4: step 3 became selected and focused. [Keyboard view](displaydeck-onboarding-keyboard-2026-09-30.png).
- Built a fresh September ACC-001 statement: opening 3500, debits 2800, receipts 2000, closing 4300. [Statement view](displaydeck-statement-2026-09-30.png).

## Validation and remaining work

17 focused tests passed across embedded contracts, onboarding permissions/validation, fresh-token fetch and UX source checks. Both root and embedded type checks passed. Durable API tests also verify created identity/contact/COD terms and changed EOM policy terms. These API tests do not establish that the stored synthetic Shopify IDs exist in Shopify.

Computer Use stopped during PDF-link activation because it could not confidently determine the browser URL. No successful PDF browser download is claimed. The displayed relative `/v1/statements/download` link needs its routing checked against the separate API origin. Finish PDF download, remaining account creation/policy browser and directory keyboard checks, and the full owner-demo scenario before closing TASK-017/042. TASK-019 still needs real provider sandbox send/callback evidence. Device/platform and independent finance acceptance remain separate.

## PDF 404 repair

The owner reported a browser 404. Added an embedded resource route at `/v1/statements/download` forwarding only the signed download parameters to the configured trade API. The route preserves PDF bytes, API rejection status and storage redirects, and disables response caching. It does not forward Shopify credentials or accept a caller-selected upstream URL.

HTTP checks against the running API and embedded app each returned 200 `application/pdf`, 4872 bytes and SHA-256 `81cb9db36be748a847844c2fb7542108cf4daf93e45e279efd7faa2a30144152`, matching the generated statement. Three route regression tests passed; both type checks passed. These are HTTP response checks, not a claim of successful browser PDF rendering.

Public preview URL also returned HTTP 200 application/pdf with 4872 bytes. Through the embedded resource route, tampered signature, expired link and cross-tenant query each returned 403.

## TASK-017 owner acceptance completed
On 2026-09-30 the owner confirmed account creation and refresh persistence, saved credit-limit/payment-term policy persistence, stale-edit rejection (409 expected v3/current v4), search returning TEST-017-01, zero and negative receipts blocked before submission, and Enter opening the focused account row after the fix. Creation, policy, conflict, search and zero-validation screenshots are saved as displaydeck-*-owner-2026-09-30.png. The owner separately confirmed browser PDF download worked. Combined with earlier durable receipt/reversal, onboarding keyboard and restart checks, TASK-017 acceptance is complete. TASK-019 provider acceptance and TASK-042 full owner-demo reconciliation remain open.

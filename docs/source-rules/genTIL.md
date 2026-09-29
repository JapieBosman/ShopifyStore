# genTIL rule extraction — TASK-064

Inspected read-only on 2026-09-29. This is the first source-backed tranche for the Shopify product. Line anchors refer to the local source files under `C:/Github/GENESIS`; hashes pin the inspected bytes. These are observed desktop branches and synthetic expected decisions, not a Delphi execution or finance sign-off.

## Source identity

| File | SHA-256 |
|---|---|
| `genTIL/Forms/VTILL001.pas` | `15A121DA40D1B92E6F4897371354AD4923AA80BE108AA2F068E90387EC981033` |
| `genTIL/Forms/VTILL002L.pas` | `28F79C1CB61413022F93EF0313A62DF550D72CF225B56F5100B6B91BC87DEC55` |
| `genTIL/System/SysSupervisor.pas` | `605C686A7EFA3B1C3BCA7B84071C29618F660576E1E57A18B9F90D6DAAB81A6D` |
| `genTIL/genTIL.dpr` | `472DBB66DA2B52AC2EF919C90B20736E6AB9234418886465A5129C1B8599906D` |

[Form inventory](../evidence/genesis-module-inventory.json) finds 317 `genTIL/Forms` captions. This is a candidate-screen index; a caption can be duplicate, inactive or informational. `genTIL.dpr` registers `VTILL000`; active menu wiring and all document handlers remain to be traced before TASK-064 completion.

## Rules traced so far

| ID | Observed behaviour and source | Called path / Shopify adaptation |
|---|---|---|
| TIL-STATUS | `VTILL001.pas:621` `Process_AccountNo` reads debtor via `su_ReadDebMst` and loads balance fields. At 732–779 closed and archived reject; inactive displays a message but continues; hold asks supervisor unless transaction is `DEBQOT`; temporary stopped requires supervisor for `POSASL` or `POSCSH`. `btnProceedClick` rejects closed again at 1271–1275. | `sup_SupervisorCheck('TIL',40)` enters `genTIL/System/SysSupervisor.pas:29`, whose standard/biometric paths run at 53–70 and modal result at 76–98. Web rule must be server-enforced and keep an audit of actor, transaction and reason; never depend on a modal alone. |
| TIL-SALETYPE | `VTILL001.pas:781–797`: `A` restricts cash sale/return; `C` restricts account sale/return; `B` allows both. | Target domain policy checks the proposed sale type before reservation/order creation. Unknown codes need explicit rejection. |
| TIL-CREDIT | `VTILL001.pas:909–910` computes legacy displayed open-to-buy as limit minus balance. At 972–988, configured `I`, `W`, `S` respectively ignore, ask/warn, stop when `gHOpenToBuy <= 0` for transaction types in `sCRLimitTxTpList`. | The new `packages/domain/src/credit.ts` must include live reservations and confirmed credits; the legacy display formula alone is insufficient for concurrent tills. Separate observed desktop modes from chosen safe Shopify policy. |
| TIL-OVERDUE | `VTILL001.pas:990–1018`: quotes and cash/account returns are excluded from overdue check. Company setting `W` warns, `S` aborts, `U` requests supervisor when overdue is positive. `btnSupervisorClick` at 1433–1474 requires permission 171 for sales order versus 78 for other sale and writes an audit record. | Preserve transaction exclusions and permission distinction in acceptance tests. Server authorisation must bind to one cart/order version and be single use. Current code path's exact `S` abort result still needs runtime/finance review. |
| TIL-PO | `VTILL001.pas:1277–1290`: when account setting `gHCaptureCustOrdNo = 'Y'`, blank purchase order/reference blocks sale progress; cash/account returns are exempt. | Apply policy to supported Shopify sale path and retain return exemption; validation belongs on server too. |
| TIL-DEPOSIT | `VTILL002L.pas:199–227`: requires nonblank reference, payment amount >0 and amount <= document total. At 230–260 `Process_Payment` generates a local receipt document (`DEBPMT`), captures till/date/reference and credit sign. | Preserve validation and distinct payment identity. Shopify partial-payment/write-back support remains TASK-003/022; never treat a local receipt as Shopify-paid without a supported remote transaction. |

The [synthetic decision fixtures](../../tests/fixtures/genesis-gentil-rules.json) cover these observed branches. `source_interpretation` identifies what code inspection supports. All are **pending Delphi execution, finance review and Shopify feasibility**, and are not automatically added as completed product tests.

## Discovered candidates for later tracing

- `VTILL002D.pas:133,198,230` has import button, document-number validation and import-document routines. `VTILL002D.dfm` labels the screen “Import Quote”; trace the document reader and acceptance lifecycle before classifying a full quotation module as Genesis parity.
- `VTILL002J.dfm` describes dispatch, deliveries and ordering. Trace handlers and stock/order ownership before implementing TASK-061.
- `VTILL039.dfm` and `VTILL039.pas` show split-payment workflow. Follow tender posting and return paths before asserting cash/card/debtor split parity.
- `System/TIL/SysPriceGrid.pas` and `genTIL/System/SysPriceGrid.pas` both exist. Determine the active unit from `genTIL.dpr`/uses and follow `spg_PickLowestPrice` and promotions through actual call sites; do not assume “lowest price wins” globally.

## Next TASK-064 work

1. Resolve active menu and used-unit wiring from `VTILL000.pas`, `genTIL.dpr` and module access flags; separate unused forms.
2. Trace quote import, deposit `Process_Payment` to posting/tender, split payment and pricing pipeline through shared System units.
3. Add at least ten independently reviewed numerical/rounding, reversal and concurrent cases to the fixtures; current decision cases are source-derived examples rather than executed parity.
4. Compare the adopted subset against `packages/domain/src/credit.ts` and TASK-003 platform evidence, recording intentional changes. Keep TASK-064 In progress until its full acceptance and review evidence is met.


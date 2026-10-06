# Economy modes and taxes — proposed rules, not activated

Requested priority 5 is rule definition. These proposals do not change any saved campaign, price, loan, reward or balance. Economy presets are Lootsplit homebrew conveniences, not claims of official D&D economic rules. Owner approval of these numbers is required before implementing them as defaults.

## One calculation path

Use existing campaign realm settings, server-authoritative commands, integer-copper ledger and approved downtime. Do not create another wallet, tax ledger, recurring scheduler, or character-profile economy. Presets supply editable starting settings; the individual settings remain authoritative. Editing a preset produces a Custom configuration. Applying a preset requires a before/after preview and DM confirmation. Do not reprice inventory acquisition history or alter existing loans.

| Proposed preset | Inflation | Scarcity | Shortage | Roads | Local / regional / realm tax | Intended experience |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Classic | 1.00 | 0 | 0 | 1 | 0 / 0 / 0% | Neutral campaign modifiers; existing shop wealth, shop adjustments and Charisma still apply |
| Casual | 0.75 | 0 | 0 | 1 | 0 / 0 / 0% | Lower buying prices without automatically increasing selling proceeds |
| Hard | 1.25 | 1 | 0.5 | 0.75 | 5 / 3 / 2% | Higher prices, modest shortages and upkeep pressure |
| Lootsplitter | 1.50 | 1.5 | 1 | 0.5 | 10 / 5 / 5% | Stronger scarcity, difficult transport and layered taxes |

Keep season at the DM's current selection; do not introduce war or plague from a preset. Display the existing pricing formula, including shop wealth/rarity/category effects, in the preview. Do not apply an inflation multiplier twice. Stock schedules remain explicitly configured per shop. Suggested property upkeep and new-loan interest can be guidance later; no preset should create debts or recurring expenses on its own.

## Tax policy

- Store three integer basis-point rates (100 basis points = 1%), each 0–10000; combined rate must not exceed 10000. Default all rates to zero for new and existing saves. Initial scope is one campaign-wide local/region/realm stack; named geographic jurisdictions need a separate specification.
- Proposed taxable events: shop purchases and approved property revenue. Sales, gifts, party transfers, loan principal, repayments, loot awards, refunds and account imports are excluded initially. A future tax on sales requires an explicit separate rule and UI.
- Purchase base: authoritative subtotal after shop price and Charisma, multiplied by quantity. For each tier, calculate `(subtotalCopper * basisPoints + 5000) / 10000` using integer division and BigInt. Add the three results. Round once per tier per transaction, never per item. Check the final value against existing balance limits before any write.
- Example: 1,000 cp subtotal at 5/3/2% gives 50+30+20 = 100 cp tax, total 1,100 cp. At 1 cp, each of these tiers rounds to 0. The receipt must explain rounding.
- Deduct purchase total in the same atomic operation as stock/inventory and ledger. Store immutable subtotal, rates, tier amounts and total on the existing transaction receipt so future settings cannot rewrite history. Retries reuse the existing command/receipt ID.
- Taxes initially leave the player economy as payment to an external authority. Do not silently credit a party fund or create duplicate income. If a campaign treasury recipient is added later, make it an explicit destination and classify the paired entries to avoid double-counting.
- For property revenue, calculate taxes over each completed property's income period, with carried fractional-copper remainders per tier so splitting downtime cannot avoid tax. Show gross income, each tax and net income in the existing downtime preview. Settle alongside income, loan payments, upkeep, shop changes and elapsed time in one approval.
- Unpaid expenses retain existing arrears. Taxes on property income cannot exceed that income under the combined-rate cap. No retroactive taxes or tax on funds already held.
- Disabling a tax affects future operations only. Historic receipts and summaries remain stable. Purchases include tax in actual gold spent; transfers are still excluded. Property tax is a finance expense, not a second purchase.

## Required implementation gates

1. DM-only configuration; server recomputes quotes and rejects stale settings/prices. Client previews call the same pure helper.
2. Zero-tax regression preserves old results exactly. Old backups missing tax fields remain readable.
3. Purchase retry/lost response, insufficient funds, quantity rounding, very large amounts, three-tier sums and refund reversal tests.
4. Property split-versus-single downtime equivalence, remainder conservation and stale-preview rejection.
5. Shared and offline transactions, Turn-based uncommitted changes, session summaries and analytics use identical rules.
6. Preset preview/cancel changes nothing; confirmation does not alter existing debt terms, historical receipts or another campaign.

Decision needed: approve or revise the proposed preset numbers and taxable events before activating this ruleset.

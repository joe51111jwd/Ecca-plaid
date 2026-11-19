# 04 - Earning on payments to vendors that never signed up, without running your own card program

Researched 2026-11-19. Web facts were fetched that day with plain curl. Copies are in the session scratchpad (`alt/`). Section 25F text comes only from the sibling files `01-rules.md` (proposed regs REG-117199-25) and `../payments-and-rails.md`. This file does not re-read the rule text.
Tags: [fetched 2026-11-19] = confirmed online today · [vendor marketing] = a seller's own claim · [inference] = my reasoning · [unverified, from memory] = not confirmed today.

## ANSWER IN FIVE LINES

1. The strongest model that needs no bank of your own is **embedding someone else's accounts-payable (AP) payout rail**. A partner such as Payabli, Melio's embedded program, Finexio or Corpay holds the bank. It sends the vendor a single-use virtual card, and pays the platform a share of the card rebate plus any fast-payout fees the vendor chooses. No partner publishes its revenue share, so you need a signed contract before you can put a number on it.
2. The rebate pool is real but thin. Corpay says buyers "commonly" net 1% to 2% of card volume. Self-service vendor enrollment reaches only "25% to 40%" acceptance, and big invoices earn the least. So expect a gross pool of about $2.50 to $8 per $1,000 of all vendor payments, before the partner's cut. Passport gets only part of that.
3. Off-the-shelf AP tools (BILL/Divvy, Ramp, Brex, Melio) pay the rebate or cashback to **the SGO**, the cardholder, not to Passport. Passport can earn only partner or referral money: BILL's "competitive revenue share" (amount not published), Relay's $50 to $200 one-time rewards, and Brex's $500 to $1,000 friend referral. That money comes per SGO, not per dollar moved.
4. "Payer pays by card, vendor gets ACH" services (BILL, Melio at 2.9%, Plastiq at 2.99%) are a **cost to the SGO**, not income to Passport. Avoid them. A vendor-paid instant payout (BILL 1.25%, Melio 1%) is a real per-dollar fee, but the vendor must actively choose it, so it only works through a payout partner.
5. Vendors can stay unaware of Passport. **The SGO cannot.** Its auditor must review how payments are made (01-rules F16). A cut taken quietly out of donor-funded payments invites the private-benefit problem (01-rules F15). Every rebate, referral fee or affiliate commission must be disclosed to the SGO in writing. Affiliate commissions (Outschool: "up to 20%") also create a conflict of interest when you steer families to vendors.

## FACTS

**(a) AP virtual-card rebates**
1. Rebate size. "Virtual card rebates commonly pay 1% to 2% of card volume, net of the issuer's share." URL https://www.corpay.com/en-GB/resources/blog/virtual-card-rebates, fetched 2026-11-19. [fetched] [vendor marketing] Medium.
2. Big invoices earn less. "On Visa's U.S. schedule, interchange on large straight-through business payments falls as the invoice grows, from 2% to 0.80% plus $35, so the biggest invoices fund the smallest rebates." Same URL. [fetched] Medium. This matches 02-card-issuing fact 18 (Visa Large Ticket rates).
3. Vendor acceptance. "Self-service enrollment portals typically reach 25% to 40% vendor acceptance after one year." Also: "The vendor pays processing costs as part of accepting any card payment". Same URL. [fetched] [vendor marketing] Medium. A search-result summary also cited "40% to 60%" for managed (phone-call) enrollment. That page returned 403, so this is [unverified].
4. A search summary said Corpay claims Visa moved B2B virtual-card interchange to "a flat 2% in October 2025". This was not found on a fetched page and not confirmed with Visa. [unverified]
5. How platforms earn on it. Visa: "The platform provides virtual cards, processes payments through a partner program manager or its own infrastructure and typically operates under a revenue share agreement on interchange with a BIN-sponsor issuer." URL https://corporate.visa.com/en/solutions/commercial-solutions/knowledge-hub/turning-transactions-into-competitive-advantages.html, fetched 2026-11-19. [fetched] High that this is the structure. No percentages are given.
6. An embedded-payout provider that sells to software platforms. Payabli Pay Out: "Equip your customers to pay vendors, sub-contractors ... while delivering a new monetization opportunity for your platform." URL https://payabli.com/pay-out/, fetched 2026-11-19. [fetched] No public revenue share; demo only.
7. Melio embedded. "Easily embed our payment services and offer your..." and "Customers and their vendors can each choose how they pay and get paid. Including ACH, instant transfers, virtual cards, and paper checks." URL https://meliopayments.com/partners/, fetched 2026-11-19. [fetched] No public terms.
8. BILL partner tracks include affiliates, banks that "embed our capabilities", and "Corporate card referral partners: Companies interested in referring BILL Spend & Expense customers and earning revenue share." URL https://www.bill.com/partners, fetched 2026-11-19. [fetched] High.
9. BILL Spend & Expense partner page: "Competitive revenue share. Get paid on qualifying transactions from every customer you introduce to BILL." Footnote: "For more information on qualifying transactions, please refer to your Partner Agreement." URL https://www.bill.com/lp/partner-program, fetched 2026-11-19. [fetched] The rate is not published.
10. BILL's own AP: paying a vendor by "Virtual Card" from a bank or BILL balance costs the payer "Free", and "BILL Divvy Card / Virtual Card: Free". URL https://www.bill.com/pricing, fetched 2026-11-19. [fetched] High. [inference] Free to the payer means BILL earns on the vendor side, through interchange.
11. Ramp Bill Pay: "If you choose to pay by card, you can use an existing Ramp card or generate a one-time virtual card. One-time cards can be sent by Ramp to the vendor's default contact on the bill's due date". URL https://ramp.com/bill-pay, fetched 2026-11-19. [fetched] Cashback goes to the Ramp customer. The rate was not confirmed today [unverified]. Ramp's partner pages returned 404 or JavaScript-only pages.
12. Brex partners: "embedding Brex's fast, global, controlled payments into your platform" and "Service partners: Earn rewards for referrals". URL https://www.brex.com/partners, fetched 2026-11-19. [fetched] No public terms.
13. AvidXchange, WEX, Corpay (main site) and Airwallex: their pages were 403, 404 or had no extractable terms. Industry memory: AvidXchange and Corpay pay buyers a share of virtual-card interchange and work mainly with mid-market and larger payers. [unverified, from memory]

**(b) "Pay by card, vendor gets ACH/check"**
14. BILL, payer side: "Pay by Card (Credit or Debit) ... 2.9%". Receiver side: "Credit or Debit Card 2.9%", "Instant Transfer 1.25%, $1 min fee", "ACH/ePayment $0.59". URL https://www.bill.com/pricing, fetched 2026-11-19. [fetched] High.
15. Melio: a credit-card payment that the vendor receives by ACH costs "2.9%" and the "Fee can be covered by either you or your customers". "When the vendor chooses the payout method": "Instant payment to debit card Fee 1%", "Instant payment to bank account Fee 1%", "Same-day ACH transfer Fee 1%", "Single-use virtual card Fee $0 You only pay your regular POS processing fees". URL https://meliopayments.com/pricing/, fetched 2026-11-19. [fetched] High.
16. Plastiq: "Plastiq assesses a 2.99% fee for each payment charged to your card". URL https://www.plastiq.com/pricing, fetched 2026-11-19. [fetched] High. The payer pays.

**(c) Business bank and card referral programs**
17. Relay (partner program for firms): "One-time cash reward for every approved client that deposits $1,000 total in their first 30 days $50 $75 $100 $150"; "...average balance of $10,000 in their first 90 days $100 $125 $150 $200"; "Quarterly revenue share when approved clients use 2+ non-core banking products in their first year* 0% 0% 5% 10%". The tiers depend on "Collective Balance" (<$50K up to $1M+). URL https://relayfi.com/partners, fetched 2026-11-19. [fetched] High.
18. Brex referral: "you'll both get $500 if they spend $5K on Brex cards in their first month. You could both get $1,000 if they sign up for banking too." URL https://www.brex.com/referral, fetched 2026-11-19. [fetched] High.
19. Mercury: amounts are not public. "Mercury will compensate Referral Partner ... in accordance with the terms specified in the Mercury Referrals Page, accessible within the Mercury Partner Portal", and Mercury "reserves the right to withhold, delay, or claw back any referral fee". URL https://mercury.com/legal/referral-partners, fetched 2026-11-19. [fetched] High.
20. BILL affiliates (through Impact): "Flexible commission rates for all approved referrals ... Monthly commission payouts through Impact". URL https://www.bill.com/partners/affiliates, fetched 2026-11-19. [fetched] The rate is not published.

**(d) K-12 vendor affiliate programs**
21. Outschool (Awin network): "We're offering up to 20% commission on all sales." "Attribution Period (Cookie Length) 30 Days". URL https://ui.awin.com/merchant-profile/18973, fetched 2026-11-19. [fetched] High that this is listed. "Up to" means the actual rate is unknown.
22. Other ed sellers checked (Varsity Tutors, IXL, Time4Learning, BJU Press, Rosetta Stone): no terms could be extracted (404, 403 or JavaScript). Many curriculum sellers run affiliate programs on networks such as Impact, Awin, CJ or ShareASale, and affiliate networks usually require an adult (18+) account holder. [unverified, from memory]

**(e) Section 25F constraints (from local files only)**
23. A vendor paid directly by the SGO must be "verified as an appropriate provider" and "required to reimburse the SGO" for payments above the student's costs. The wallet route's text has no such vendor condition. 01-rules F8, F10. [proposed-reg] High.
24. The audit must cover "the method(s) the organization uses to track how scholarship money ... is paid". 01-rules F16. Interchange, rebates and platform fees are not addressed anywhere. 01-rules F12; payments-and-rails fact 16. [proposed-reg] High.
25. A scholarship must be "motivated by a disinterested educational purpose, not by private or business interests". 01-rules F15 (preamble). High that the text exists.

## WHAT IT MEANS FOR PASSPORT

Per-option summary. "$/1,000" means per $1,000 of scholarship money paid to vendors.

| Option | Vendor must agree? | Passport needs a bank? | Who bears the cost | Rough $/1,000 to Passport | Time to start | Main catch |
|---|---|---|---|---|---|---|
| A. Embedded AP payout partner (Payabli, Melio embedded, Finexio, Corpay): single-use virtual card to any vendor | Only to run the card on its own terminal. It signs nothing with Passport. Refusers get ACH/check. | No. The partner holds the bank. | The vendor (its normal card fee) | Gross pool ~ $1,000 x 25-40% acceptance x 1-2% = **$2.50-$8** (F1, F3). Passport gets an unknown share of that. | Months: sales cycle, KYB, contract signed by an adult | Shares not public. Tuition and large invoices earn least (F2). Rebate on charitable money: whose is it? |
| B. SGO uses BILL/Divvy, Ramp or Brex directly; Passport is a referral partner | Same as A | No | The vendor. The rebate goes to the SGO. | Per $1,000: **not stated** (BILL share unpublished, F9). Brex: $500-$1,000 one-time per SGO (F18) | Weeks (partner application) | Revenue tied to SGO count, not volume. Passport sits outside the money flow. |
| C. Payer-pays card-to-ACH (BILL, Melio, Plastiq) | No | No | **The SGO**, 2.9-2.99% (F14-F16) | **$0** (the provider keeps the fee) | n/a | Burns scholarship or admin money. Do not use. |
| D. Bank-account referral for the SGO's 25F account (Relay, Mercury) | n/a | No | Nobody | Relay: $50-$200 one-time per SGO, plus 0-10% quarterly share on extra products (F17). Mercury: not public (F19). | Weeks | Tiny. Relay's program is aimed at accounting firms. |
| E. Vendor affiliate links (Outschool and similar) | The vendor's network approves Passport as an affiliate. The vendor knows. | No | The vendor's marketing budget | Outschool "up to 20%" means **up to $200** on Outschool spend only (F21). Other vendors unknown. | Days to weeks, but needs an adult account holder | Conflict of interest. Steering families looks like private benefit (F25). Only works for vendors with programs. |
| F. Vendor-chosen instant payout fee | **Yes**, the vendor picks it | Needs a payout partner (A) | The vendor | If Passport set 1% like Melio (F15): $10 x opt-in rate x Passport's share. Opt-in rate unknown. | Comes with A | The vendor sees Passport. Any fee must be clearly optional. |

Concrete reading:
- No option lets Passport keep "a small fee on all volume" without someone holding a bank. Options A and F hand the bank to the partner, and Passport takes a contracted share. That is the bank partnership one step removed.
- **Realistic ceiling: about $2.50 to $8 gross per $1,000 under option A**, before the partner's cut. On $10M of vendor payments the gross pool is about $25K to $80K a year. Passport's share is unknown [inference from F1, F3].
- Option A's rebate is earned on SGO money, with the SGO as cardholder. Industry practice pays it to the buyer (F1). [inference] An SGO's auditor will likely say the rebate belongs to the SGO, and possibly to its 25F account. Passport keeping it needs explicit written agreement. Otherwise, structure it as Passport's partner fee paid by the AP provider out of its own margin.
- The cleanest income remains a **disclosed software fee** the SGO pays from administrative funds outside the 25F account (payments-and-rails 15A). Use rebate or partner income to cut that fee, not to replace disclosure.

## RISKS AND BLOCKERS

- **Concealment is out.** The SGO's audit covers payment methods (F24). Any rebate, referral fee or commission tied to scholarship payments must be disclosed to the SGO in writing. Families should also see that Passport may earn from vendors, at least when affiliate links are used.
- **Vendors that never signed up.** On the direct route, the vendor must be "verified" and "required to reimburse" (F23). A card pushed to a vendor that signed nothing may not satisfy that. This is a counsel question, and it bears on all virtual-card options.
- **Concentration.** Tuition is the biggest dollar flow. It often goes by ACH or check, and large card tickets earn little (F2). The rebate pool may come mostly from small camp, tutor and curriculum payments.
- **Undisclosed economics.** Not one partner (BILL, Melio, Payabli, Ramp, Brex, Corpay, AvidXchange, WEX, Airwallex, Mercury) publishes a platform revenue share. Every per-$1,000 figure for Passport stays unknown until a term sheet arrives.
- **Age.** Partner, affiliate and payout contracts need an adult signer or a company with an adult officer [unverified, from memory, for most programs]. See 02-card-issuing fact 12 for Stripe's rule.
- **Partner program rules.** Referral programs usually ban misleading promotion, and Mercury can claw back fees (F19). Affiliate networks often restrict incentivized traffic [unverified, from memory].
- **Consumer-use limits.** Some providers bar programs that move consumer or family funds (Stripe, 02-card-issuing fact 11). Business AP partners will ask the same KYB questions about SGO money.

## OPEN QUESTIONS

1. Which embedded AP partner (Payabli, Melio embedded, Finexio, Corpay, BILL embedded) will pay a software platform a rebate or fee share for a nonprofit payer with $1M to $10M of yearly volume, and at what split and minimum?
2. Does the rebate on a virtual card funded from the 25F segregated account belong to the SGO or its 25F account, and does it count as "earnings" in the 90 percent base? (Not in sources. Counsel.)
3. Does pushing a virtual card to an unenrolled vendor meet the "verified" and "required to reimburse" conditions, or must it go through the wallet route?
4. What real vendor acceptance rate do camps, tutors and small schools show for virtual cards? Corpay's 25-40% is a general AP figure (F3).
5. Did Visa really move B2B virtual-card interchange to a flat 2% in October 2025 (F4)?
6. Is an affiliate commission on a scholarship-funded purchase compatible with the "disinterested educational purpose" language, if it is disclosed?

## RANKED SHORTLIST (founder with no bank relationship)

1. **Disclosed SaaS fee from SGO admin funds.** No bank needed, cleanest under 25F. This is the baseline, not a volume fee.
2. **Embedded AP payout partner (option A, plus optional vendor instant-payout fee F).** The only route to a true per-dollar fee on vendors that never signed up. Start now: request term sheets from Payabli, Melio embedded and Finexio and compare splits. Expect at most a few dollars per $1,000.
3. **Referral partner to BILL Spend & Expense or Brex for each SGO (B).** Quick to start, small, and disclosed to the SGO.
4. **Bank referral for the 25F account (D).** Minor one-time income.
5. **Affiliate links (E).** Only with written disclosure, and never used to steer which vendor a family picks. Lowest priority because of conflict risk.
6. **Payer-pays card-to-ACH (C).** Do not use. It costs the SGO and earns Passport nothing.

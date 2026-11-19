# 03 - How incumbents earn money on education-benefit payment volume

Written 2026-11-19. Question: how do existing platforms charge a small percentage on restricted scholarship/ESA money, and which of those charges need the vendor to agree?

- Pages fetched today with plain curl are saved in `scratchpad/sources/inc03/` (`scratchpad` = `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad`). Pages saved by the earlier researcher (fetched 2026-11-18) are in `scratchpad/sources/extra/`. Facts already verified in `docs/reference/market-and-integration-context.md` (cited as `MIC #nn`) are not redone. Section 25F points come from `money-movement/01-rules.md` only.
- Tags: [state doc] = government document. [news] = reputable news, fetched today. [vendor site] = company's own page. [search summary] = shown in a search-engine summary; I could not open the page, so treat it as unverified. [unverified, from memory] = not confirmed today. NOT PUBLIC = I looked and did not find it.

---

## ANSWER IN FIVE LINES

1. The industry has four revenue lines: (a) a fee the program pays (per account, flat, or a % of volume); (b) a % deducted from what the vendor receives; (c) card interchange on a restricted debit card; (d) interest on balances it holds. Rates actually published: 0.25% to 2.5%.
2. The vendor-paid % is the line that matches "a small fee on volume". ClassWallet takes 2.5% off DirectPay vendor payments in North Carolina ($25 per $1,000). In Arkansas it bid 1.85%, and Student First charged 2%. But every vendor on that line is enrolled: it has signed a provider agreement and receives payment net of the fee. You cannot deduct a fee from a vendor that never agreed to it.
3. The only route that earns on a vendor who never signed up is a card. Student First's TheoPay virtual Mastercard says "No vendor onboarding" and "no platform fees on the recipient side". The vendor pays only its normal card-acceptance cost. That card is issued by a bank (Bangor Savings Bank), so this is still a bank partnership, just one held by the program manager. No interchange rate or revenue share is public.
4. Hiding fees fails in public. Iowa's auditor flagged Odyssey's added per-transaction fees. Idaho made Odyssey pay back $478,656 of interest earned on program money. North Carolina tells vendors they may pass the 2.5% back to families. States, auditors and the press all look at these fees.
5. For Passport without its own bank: a % fee the SGO pays openly (0.25% to 2.5% = $2.50 to $25 per $1,000) needs only the SGO's agreement. A vendor-paid % needs each vendor's agreement. Revenue from a vendor that never signed up requires riding someone else's card program (rate not verified).

---

## FACTS

**1. ClassWallet charges DirectPay vendors 2.5% of each payment; the vendor gets $97.50 of $100.** [state doc] High.
> "Payments through ClassWallet are assessed a 2.5 % fee, similar to how merchants pay for accepting credit card payments. If an ESA+ parent requests to pay $100 to a provider, the provider will receive $97.50."
The same deck says "Direct Pay Vendors are the Providers. Families submit an invoice and select the correct Provider from the list of Direct Pay Vendors", and it includes a section titled "Provider Agreement". It also allows the fee to be passed on: "if you charge that credit card fee to your customers, then yes, you can charge the ClassWallet transaction fee to your ESA+ parents, and the ESA+ funds can pay for it."
SRC: NC State Education Assistance Authority, "Provider Introduction to ESA+", July 2025, https://k12.ncseaa.edu/media/roqmwfwh/provider-introduction-to-esaplus-july-2025_final.pdf (fetched 2026-11-19; `inc03/nc_esaplus.txt` lines 137-140, 305-331).

**2. ClassWallet's marketplace/e-commerce vendors pay a processing fee "as percentage of orders". The rate is not stated on ClassWallet's site.** [vendor site] High. Already verified: MIC #32.

**3. Arkansas: ClassWallet charged 2.5% in year one, then bid a 1.85% settlement fee on payments to vendors and schools. Student First charged 2%.** [news, Arkansas Times republished on classwallet.com, 2024-11-21] Medium-high.
> "ClassWallet's proposal describes a 1.85% settlement fee assessed on payments to vendors and schools. That's less than the 2% transaction fee charged by Student First, and significantly less than the 2.5% fee ClassWallet charged during its first year as vendor in Arkansas."
The same article gives the state's estimated contract cost: "just under $14 million over the next seven years". The bidders scored against ClassWallet were Odyssey, Merit International and ACE Scholarships.
SRC: https://classwallet.com/state-voucher-program-to-return-to-classwallet/ (fetched 2026-11-19; `inc03/ar_cw_return.txt` lines 74-80). A search summary also reported a one-time $49,000 service fee and a $75,000 implementation fee [search summary, unverified].

**4. Idaho (2024): ClassWallet "will receive a 2% service fee for purchases on its online portal", up to $600,000 a year.** [news] High.
SRC: Idaho Education News, 2024-10-02, https://www.idahoednews.org/top-news/state-makes-a-big-and-unexplained-change-on-empowering-parents-contract/ (fetched 2026-11-19; `inc03/id_change.txt` line 66).

**5. Tennessee's ESA law caps the payment vendor's cut at 2% per account. The state considered paying half and passing "1% ... on to the participating school".** [news, 2019] High.
> "allows the department to charge families a state administrative fee of up to 6% — and another 2% to a payment management vendor — for each education savings account." / "We may end up splitting that so that the state assumes 1%, and 1% is passed on to the participating school"
SRC: Chalkbeat, 2019-11-13, https://www.chalkbeat.org/tennessee/2019/11/13/21055624/tennessee-inks-2-5-million-contract-with-florida-company-to-manage-education-voucher-payments (fetched 2026-11-19; `inc03/tn_chalkbeat.txt` lines 44-45).

**6. New Hampshire 2021 ClassWallet contract: $10 per student per year, a $51 application fee per family, and 2.5% DirectPay transaction fees "invoiced monthly to the DOE".** [search summary, unverified] The source PDF (https://sos.nh.gov/media/qgyiace3/080-gc-agenda-092921.pdf) returned HTTP 503 today.

**7. Odyssey's 2023 Iowa bid priced its work as flat line items, with no percentage: $629,550 a year ($582,333.75 in year 1 after a 7.5% discount).** [state doc] High.
SRC: Iowa DAS RFP #005-RFP-0317-2023, Odyssey Cost Proposal, https://bidopportunities.iowa.gov/Home/GetBidOpportunityDocument/92d31ccb-fdee-410f-8834-0c6e2b6dc9e6 (fetched 2026-11-19; `inc03/ia_92d31ccb-...txt`, "Investment Breakdown").

**8. Iowa later amended Odyssey's contract to add transaction fees. The State Auditor said the amendment would more than double the cost and that no justification was documented.** [news] High for the facts below.
> "The extra cost comes from 25-cent transaction fees and some other changes. Sand said in a news conference that no justification for the increase has been provided." / "State officials including Reynolds said these transaction fees are a normal part of working with e-commerce companies, and that Odyssey's numbers are less expensive than any other vendor."
SRC: Iowa Starting Line, 2024-07-25, https://iowastartingline.com/2024/07/25/rob-sand-reports-iowa-taxpayers-will-pay-double-for-the-voucher-program (fetched 2026-11-19; `inc03/ia_audit_918ed9.txt` lines 67-77).
Details seen only in search summaries [unverified]: the fee is 25 cents per $100 of qualified expenses (0.25%), plus 5 cents per transaction, a $100,000 standalone-system fee, and reimbursement of payment-processing fees. Iowa officials said other vendors charge 2.5%.

**9. Louisiana GATOR: the state pays Odyssey $143.50 per student account, under a $1.9 million cap.** [news, The Center Square via The Hayride, 2025-06-23] High.
> "A portion of the funding — $143.50 per student account—will go toward Odyssey's costs of administering each account"
SRC: https://thehayride.com/?p=270806 (fetched 2026-11-19; `inc03/la_hayride.txt` line 44).

**10. Utah Fits All: Odyssey's contract is $9,737,500 (about $9.7 million over two years). Fee structure NOT PUBLIC.** [state doc + news] High.
SRC: https://www.utah.gov/pmn/files/1264715.pdf (`inc03/ut_contract.txt` line 62); Idaho Education News, 2025-05-08, https://www.idahoednews.org/news/a-vendor-with-a-spotty-idaho-record-lands-a-big-management-deal-in-utah/ (line 60). Both fetched 2026-11-19.

**11. Interest on balances (float) was clawed back. Idaho ordered Odyssey to repay $478,656.22 "in interest it had collected from Empowering Parents' federal funding". A state review also found about 1% ineligible purchases ($180,000).** [news] High.
SRC: `inc03/id_change.txt` lines 60, 86 (URL as in fact 4).

**12. How Odyssey pays vendors: by ACH after delivery, through Stripe. Vendors are approved and onboarded first. Any vendor-side fee is NOT PUBLIC.** [vendor site] High.
> "Fast, low-cost ACH payments to schools, vendors, and providers, transferred after proof of delivery." / "Once approved, connecting your bank account through our trusted payment processor, Stripe"
SRC: `extra/odyssey_sgos.txt` line 70; `extra/odyssey_vendors.txt` line 45 (fetched 2026-11-18). See also MIC #36.

**13. Student First's TheoPay pays vendors that never signed up, using a single-use virtual debit card issued by a bank.** [vendor site] High.
> "No fees, integrations, or uploads. Families shop your site and check out like any customer." / "A one-time-use card is issued for that specific purchase." / "No integration required, and no platform fees on the recipient side." / "The Student First Technologies Mastercard® Debit Card is issued by Bangor Savings Bank, Member FDIC"
SRC: `extra/studentfirst_theopay.txt` lines 82, 195, 240, 268 (fetched 2026-11-18). Student First's SGO pricing is "scoped to your program", and schools and vendors pay no platform fees (MIC #38). Whether Student First gets any share of the card's interchange: NOT PUBLIC. My assumption that it does is [unverified, from memory].

**14. Student First's public failures.** [news] High.
- Arkansas cancelled its contract and sought "$563,000 in penalties and damages due to missed deadlines and non-functioning systems" (`inc03/ar_cw_return.txt` line 70).
- In West Virginia, "almost 3,000 of the 9,000 orders submitted through the company's platform had not been processed" in late September 2024. The 74 also noted that critics say these middlemen raise costs, citing Iowa's added Odyssey transaction fees. SRC: The 74, 2024-10-09, https://www.the74million.org/article/overwhelmed-esa-systems-in-west-virginia-arkansas-leave-thousands-of-homeschoolers-hanging/ (`inc03/sf_74.txt` lines 130, 169-170).
- Tennessee raised Student First's contract ceiling by $356M in 2026 [search summary, unverified; the page returned 403].

**15. ClassWallet's public failures.** [news] High.
- Arkansas, 2026: "a current backlog of 41,000 EFA requests". Also: "A lot of vendors are not participating because the turnaround is so long". SRC: KATV, 2026-07-01, https://katv.com/news/local/efa-platform-vendor-flaws-backlog-arkansas-school-choice-payments-brian-evans-breanne-davis-learns-act-school-choice-voucher-classwallet-class-wallet-student-first-technologies-education-freedom-accounts (`inc03/ar_katv.txt` lines 45-49).
- Arizona, 2026: the Auditor General found 2.3 million transactions ($654M) were auto-processed. The department ran risk checks on ClassWallet transactions "but ... didn't apply the same scrutiny to prepaid debit cards or reimbursements, which accounted for around $102 million". SRC: KJZZ, 2026-05-13, https://www.kjzz.org/education/2026-05-13/state-auditors-flag-purchase-review-problems-in-arizonas-school-voucher-program (`inc03/az_kjzz.txt` lines 330-332).
- Arizona's Treasurer has opened a request for information that could replace ClassWallet. SRC: Arizona Capitol Times, 2026-06-05, https://azcapitoltimes.com/news/2026/06/05/state-treasurer-seeks-esa-vendor-to-track-misspending-fraud/ (`inc03/az_treas.txt` line 144). The same article says Odyssey "lost business to ClassWallet [in Idaho] after ongoing issues with payments to vendors and customer service" (line 165).

**16. ClassWallet's four payment rails: DirectPay, Marketplace, Reimbursement and a restricted Debit Card. Linked debit cards are excluded from pre-approval.** [vendor site] High. Already verified: MIC #30. Rates for the card and reimbursement rails: NOT PUBLIC.

**17. Merit International** bid for the Arkansas (2024) and Iowa (2023) ESA contracts and ran Kansas's KEEP program. Its fees: NOT PUBLIC (none found in Merit's Iowa technical response, `inc03/ia_457acf86-...txt`). Low relevance.

**18. Truemed: the merchant pays, and the fee is netted from payouts. The rate is NOT PUBLIC.** truemed.com/pricing returned 404 again today. Already verified: MIC #53.

**19. Flex (HSA/FSA checkout): the Shopify app is listed with pricing "Free". A per-transaction merchant fee is NOT PUBLIC.** withflex.com/pricing returned 404. [vendor site] SRC: https://apps.shopify.com/flex-shop-pay (fetched 2026-11-19; `inc03/fl_fd3b52.txt` lines 44-46). That merchants pay Flex a percentage is [unverified, from memory].

**20. Secondary claim that "ClassWallet charges vendors a 2.5% service fee ... Families using the platform don't pay transaction fees".** [secondary blog, low] SRC: https://numaschool.com/learn/glossary/classwallet (`inc03/numa.txt` line 72). Consistent with fact 1.

---

## WHAT IT MEANS FOR PASSPORT

Revenue lines that exist, their published size, and who has to agree:

| Line | Published rates | Per $1,000 paid to a vendor | Vendor must agree? | Bank needed? |
| --- | --- | --- | --- | --- |
| A. % of volume paid by the program/SGO | 0.25% Iowa (unverified detail), 2% Idaho, TN cap 2% | $2.50 - $20 | No; the SGO must agree | No (if the SGO's own bank pays the vendor) |
| B. Per-account / flat fee paid by the program | $143.50/account LA; $10/student NH (unverified); Iowa $629,550/yr flat | n/a (per family) | No | No |
| C. % deducted from the vendor's payment | 2.5% NC/AR yr1, 1.85% AR bid, 2% Student First AR | $18.50 - $25 | **Yes**: enrolled provider, accepts net payment | Needs a payout rail (Stripe/ACH processor) |
| D. Card interchange (vendor never signs up) | NOT PUBLIC | cannot be stated | No; the vendor already accepts cards | **Yes**: issuing bank, via a program manager |
| E. Interest on held balances | Idaho clawback $478,656 | do not plan on it | No | Yes |

Concrete reading:
1. "Vendors who never signed up still get paid, and we take a cut" exists in one form only: line D, a restricted virtual card (TheoPay, ClassWallet's debit card). It needs an issuer. Without Passport's own bank, the path is to plug into an existing card program manager or wallet that already has an issuing bank, and negotiate a share. Nothing public lets me size that share.
2. Line C is the clearest "% of volume" model. But it only works on vendors who enroll and accept being paid net. For a non-enrolled vendor paid by ACH or check, short-paying them does not work: they invoiced the full price and will chase the difference. Line C is therefore an opt-in for vendors, e.g. "get paid in 2 days instead of 30 for 2%".
3. Line A is available today, with no vendor contact and no bank, if the SGO pays it openly. At incumbent rates, 1% would be $10 per $1,000 paid out. It sits inside the SGO's budget, which faces the 10% limit (01-rules). Iowa's officials defended 0.25% as cheaper than the 2.5% norm, which sets the price anchor.
4. Reimbursement (the family pays and the SGO repays) earns nothing for anyone except through line A.

## RISKS AND BLOCKERS

- **Invisibility is not available.** Fees were surfaced by a state auditor (Iowa), clawed back (Idaho interest), or put in public bid documents (AR, IA, LA). The SGO and its auditor must document the payment method (01-rules). Design every fee to be disclosed to the SGO.
- **Vendor fees leak back to families.** NC lets vendors who surcharge cards pass the 2.5% on, paid from ESA funds (fact 1). Under 25F, a pass-through that raises the price above the student's real cost risks the excess-payment refund rule (01-rules).
- **Operational failure is the main way incumbents lost contracts.** Backlogs (AR 41,000 requests; WV 3,000 orders) drive vendors away and lead to cancellations and penalties ($563,000 sought from Student First).
- **Card rail blind spot.** Arizona's auditor found debit-card and reimbursement spending (~$102M) got less scrutiny. A card-based model must still meet the wallet "controls" definition (01-rules).
- **Line D still depends on a bank.** It is the bank partnership the founder wants to avoid, held by a partner instead.

## OPEN QUESTIONS

1. What interchange revenue share do restricted-card program managers (e.g., Student First/Bangor, ClassWallet's card issuer) give a platform? NOT PUBLIC.
2. Does ClassWallet or Odyssey take a vendor fee on federal-credit (25F) SGO programs, or only on state ESAs? Not stated on their 25F pages.
3. Truemed and Flex merchant rates: NOT PUBLIC. Ask them directly if needed.
4. Does an SGO-paid % fee count toward the SGO's 10% admin limit? Ask counsel (01-rules Q4).
5. Unverified items to re-check: the NH contract terms (PDF returned 503), the Iowa "per $100" wording, and Tennessee's $356M Student First increase.

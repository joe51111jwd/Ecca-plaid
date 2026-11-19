/**
 * Donor checkout screens (Piece 1): the hosted page under /give, the widget under /embed/give, and the pieces
 * they share. Pages import from here; client components inside this folder import each other directly so a
 * client bundle never pulls in the server-side flow.
 *
 *   <CheckoutProvider access initialView initialPayment returnUrl>   state + autosave + place order
 *     <CheckoutForm states />  <LiveTaxMathPanel />                  the form and its live panel
 *   resolveCheckout(token, slug) / loadReceipt(token)                 page data (server)
 */
export { CheckoutProvider, SAVE_DEBOUNCE_MS, useCheckout, type CheckoutProviderProps, type ClientAccess } from "./CheckoutProvider";
export { CheckoutForm, type CheckoutFormProps } from "./CheckoutForm";
export { LiveTaxMathPanel } from "./LiveTaxMathPanel";
export { TaxMathPanel, type TaxMathPanelProps } from "./TaxMathPanel";
export { CreditBanner, type CreditBannerProps } from "./CreditBanner";
export { GiftIntro, type GiftIntroProps } from "./GiftIntro";
export { ReceiptView, type ReceiptViewProps } from "./ReceiptView";
export { RefreshWhile, type RefreshWhileProps } from "./RefreshWhile";
export { SgoSummary, type SgoSummaryProps } from "./SgoSummary";
export { newGiftAction, placeOrderAction, saveCheckoutAction, startGiftAction } from "./actions";
export { accessSchema, checkoutCookieName, checkoutCookieOptions, checkoutPaths, slugSchema, tokenSchema, type CheckoutAccess } from "./access";
export { beginGift, loadCheckout, loadReceipt, placeGift, resolveCheckout, saveGift, usStateOptions, type LoadedCheckout, type LoadedReceipt, type ResolvedCheckout } from "./flow";
export {
  buildReview,
  checkoutLabels,
  creditBanner,
  directoryListNotice,
  FORM_BLOCKER_CODES,
  RECEIPT_ELIGIBILITY_FRESH_MS,
  STANDING_PANEL_NOTES,
  standingPanel,
  toClientView,
  toReceiptSummary,
  type CheckoutClientView,
  type ClientPanel,
  type CreditBanner as CreditBannerData,
  type ReceiptSummary,
} from "./view-model";

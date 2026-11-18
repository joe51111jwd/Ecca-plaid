/**
 * The design-system kit. Import everything from "@/components/ui".
 * Every component is rendered, in every state, with usage notes at /styleguide.
 */

// Foundations
export { cn } from "./cn";
export { isExternalHref } from "./href";
export { UI_STRINGS, uiStrings, type UiLocale, type UiStrings } from "./locale";

// Actions
export { Button, IconButton, TextLink, buttonClasses, type ButtonProps, type ButtonSize, type ButtonVariant, type IconButtonProps, type TextLinkProps } from "./button";

// Form controls
export { Field, Fieldset, type FieldControlProps, type FieldProps } from "./field";
export { Input, Select, Textarea, type ControlSize, type InputProps, type SelectProps, type TextareaProps } from "./input";
export { Checkbox, Switch, type CheckboxProps, type SwitchProps } from "./checkbox";
export { CheckboxGroup, type CheckboxGroupProps } from "./checkbox-group";
export { RadioGroup, type RadioGroupProps, type RadioOption } from "./radio-group";
export { MoneyInput, type MoneyInputProps } from "./money-input";
export { formatMoneyText, parseMoneyText, sanitizeMoneyText } from "./money-format";
export { DateInput, type DateInputProps } from "./date-input";
export { checkDateParts, isoFromParts, parsePastedDate, partsFromIso, type DateParts, type DatePartsProblem, type DatePartsResult } from "./date-parts";
export { OtpInput, type OtpInputProps } from "./otp-input";
export { FileDropzone, type DropzoneFile, type DropzoneFileStatus, type FileDropzoneProps } from "./file-dropzone";
export { formatBytes, matchesAccept, partitionFiles, type FileRejection, type FileRejectionReason, type FileRules } from "./file-rules";

// Forms with server actions
export { Form, FormActions, FormError, SubmitButton, type FormActionsProps, type FormErrorProps, type FormProps, type SubmitButtonProps } from "./form";
export { fieldError, formMessage, hasFormError, type FormState } from "./form-helpers";

// Layout and content
export { Card, CardBody, CardFooter, CardHeader, PageHeader, Section, type Breadcrumb, type CardHeaderProps, type CardProps, type PageHeaderProps, type SectionProps } from "./card";
export { KeyValue, KeyValueList, Stat, StatGrid, type KeyValueItem, type KeyValueListProps, type KeyValueProps, type StatGridProps, type StatProps } from "./stat";
export { LineItems, type LineItem, type LineItemsProps } from "./line-items";
export { Table, type TableColumn, type TableProps, type TableSort } from "./table";
export { Pagination, type PaginationProps } from "./pagination";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { Tabs, type TabItem, type TabsProps } from "./tabs";
export { ProgressSteps, Stepper, type Step, type StepperProps } from "./stepper";
export { ProgressBar, type ProgressBarProps } from "./progress-bar";
export { Accordion, Disclosure, type AccordionItem, type AccordionProps, type DisclosureProps } from "./disclosure";
export { Timeline, type TimelineItem, type TimelineProps } from "./timeline";

// Status and messaging
export { Badge, type BadgeProps, type Tone } from "./badge";
export { StatusBadge, type StatusBadgeProps } from "./status-badge";
export { STATUS_KINDS, STATUS_MAP, STATUS_VALUES, statusLabel, statusSpec, type StatusKind, type StatusKinds, type StatusSpec } from "./status-map";
export { ProvisionalBadge, ProvisionalNotice, type ProvisionalBadgeProps, type ProvisionalNoticeProps } from "./provisional";
export { Alert, Banner, Callout, LegalNote, type AlertProps, type AlertTone, type BannerProps, type BannerTone } from "./alert";
export { FlashToast, ToastProvider, useToast, type FlashToastProps, type ToastOptions, type ToastTone } from "./toast";

// Overlays
export { ConfirmButton, ConfirmDialog, Dialog, DialogButton, Drawer, useDisclosure, type ConfirmButtonProps, type ConfirmDialogProps, type DialogButtonProps, type DialogProps, type DrawerProps } from "./dialog";
export { DefinitionTooltip, Tooltip, type DefinitionTooltipProps, type TooltipProps } from "./tooltip";
export { DropdownMenu, type DropdownMenuProps, type MenuItem } from "./menu";

// Data display
export { Money, type MoneyProps } from "./money";
export { DateTime, type DateTimeProps } from "./date-time";
export { DEFAULT_TIME_ZONE, formatDateTime, formatFullTimestamp, type DateTimeFormat, type DateTimeOptions } from "./date-format";
export { Avatar, OrgMark, initialsOf, type AvatarProps, type OrgMarkProps } from "./avatar";
export { CodeBlock, CopyButton, CopyField, type CodeBlockProps, type CopyButtonProps, type CopyFieldProps } from "./copy";
export { LanguageToggle, type LanguageToggleProps } from "./language-toggle";
export { Logo, LogoMark, type LogoMarkProps, type LogoProps } from "./logo";
export { Skeleton, type SkeletonProps } from "./skeleton";
export { Spinner, type SpinnerProps } from "./spinner";

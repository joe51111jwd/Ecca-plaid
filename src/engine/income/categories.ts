/**
 * The income category registry: what counts as household cash income for the section 25F income test.
 *
 * LEGAL STATUS. Every row is PROPOSED-RULE treatment. 24 CFR 5.609 ("annual income") applies to section 25F
 * only because proposed Reg. 1.25F-3(c)(6)(ii)(C) (REG-117199-25, not final) adopts it, with three changes:
 * the imputed return on net assets is disregarded, child support and alimony are included even when they
 * are not in taxable income, and non-cash receipts are excluded. Household income is not adjusted gross
 * income, and no deduction of any kind is taken (24 CFR 5.611 is not referenced by the proposed rule).
 *
 * SOURCE. The rows are transcribed from the Income Category Table in
 * docs/reference/hud-ami-and-annual-income.md (sections A to E), which cites each paragraph. Keys are
 * stable: they are stored in `income_items.category` and printed in evidence packs. Do not rename a key;
 * add a new one and bump `INCOME_TAXONOMY_VERSION`.
 *
 * TREATMENT.
 *  - `counted`:  the cash amount received in the income year is added to household income.
 *  - `excluded`: never added. The item is still kept, with its reason, for the audit trail.
 *  - `review`:   the sources do not settle it, or facts are needed. The amount enters the UPPER bound of
 *                household income only; a person decides whenever the difference can change the outcome
 *                (see compute.ts).
 *
 * This registry drives the family intake form, the reviewer form and the evidence pack.
 */

export const INCOME_TAXONOMY_VERSION = "income-taxonomy.2026-11-18.v1";

/** Rule set the taxonomy transcribes. Printed next to every income computation. */
export const INCOME_RULE_SET = "24 CFR 5.609 (eCFR as of 2026-11-01) as adopted and modified by proposed Reg. 1.25F-3(c)(6)(ii)(C), REG-117199-25 (proposed, not final)";

export type IncomeTreatment = "counted" | "excluded" | "review";
export type IncomeCategoryGroup = "earned" | "benefits" | "assets" | "one_time" | "non_cash";
export type IncomeLocale = "en" | "es";
export type Localized = Readonly<Record<IncomeLocale, string>>;

/**
 * Whose income a category describes.
 *  - `household`: any household member whose income counts under 24 CFR 5.609(a)(1): every member aged 18
 *    or older, the head of household or the head's spouse at any age, and, for UNEARNED income only, each
 *    dependent under 18. Earned income of a child under 18 is excluded (5.609(b)(3)), and for a dependent
 *    full-time student aged 18 or older only earned income up to the dependent deduction amount is counted
 *    (5.609(b)(14)). The engine applies those two rules from the member's facts; nobody has to pick a
 *    special category for them.
 *  - the other values name the one kind of member the category is for. An item filed under such a category
 *    for anyone else is sent to review.
 */
export type IncomeAppliesTo = "household" | "minor_not_head_or_spouse" | "minor_head_or_spouse" | "dependent_full_time_student" | "live_in_aide" | "foster_member";

/** `family`: offered on the family intake form. `reviewer`: only a reviewer assigns it. */
export type IncomeCategoryAudience = "family" | "reviewer";

export interface IncomeCategory {
  key: IncomeCategoryKey;
  group: IncomeCategoryGroup;
  treatment: IncomeTreatment;
  appliesTo: IncomeAppliesTo;
  /**
   * Earned income under 24 CFR 5.100: "wages, tips, salaries, other employee compensation, and net income
   * from self-employment". Pensions, annuities, transfer payments and benefits are not earned income.
   */
  earned: boolean;
  /** Self-employment or business income. A person always reviews it (see compute.ts). */
  selfEmployment: boolean;
  /** Only the amount up to the HUD dependent deduction is counted; the rest is excluded (5.609(b)(14), (b)(15)). */
  cappedAtDependentDeduction: boolean;
  /** A negative amount (a net loss) is meaningful for this category. */
  allowsNegative: boolean;
  audience: IncomeCategoryAudience;
  label: Localized;
  /** One plain-language sentence for the person filling in or checking the form. */
  help: Localized;
  /** Citation: 24 CFR 5.609 paragraph and/or the proposed section 25F rule. */
  basis: string;
  /** Conditions and open points a reviewer needs; null when there are none. */
  reviewerNote: string | null;
}

const PROPOSED_HOUSEHOLD_INCOME = "Prop. Reg. 1.25F-3(c)(6)(ii)(C)";

type CategoryRow = Omit<IncomeCategory, "key" | "appliesTo" | "earned" | "selfEmployment" | "cappedAtDependentDeduction" | "allowsNegative" | "audience" | "reviewerNote"> &
  Partial<Pick<IncomeCategory, "appliesTo" | "earned" | "selfEmployment" | "cappedAtDependentDeduction" | "allowsNegative" | "audience" | "reviewerNote">>;

const ROWS = {
  /* ------------------------------------------------------------------------------- A. Earned income */
  wages_salary: {
    group: "earned",
    treatment: "counted",
    earned: true,
    label: { en: "Wages and salaries", es: "Sueldos y salarios" },
    help: {
      en: "Pay from a job before taxes and other deductions are taken out.",
      es: "El pago de un empleo antes de descontar impuestos y otras deducciones.",
    },
    basis: "24 CFR 5.609(a)(1); 5.100 (earned income)",
    reviewerNote:
      "Use gross pay before garnishments and levies. The sources do not say whether pre-tax payroll deductions are added back or which Form W-2 box governs; record the figure used and the document field it came from.",
  },
  tips_commissions_bonuses_overtime: {
    group: "earned",
    treatment: "counted",
    earned: true,
    label: { en: "Tips, commissions, bonuses and overtime", es: "Propinas, comisiones, bonos y horas extra" },
    help: {
      en: "Tips, commissions, bonuses, overtime and any other pay from an employer.",
      es: "Propinas, comisiones, bonos, horas extra y cualquier otro pago de un empleador.",
    },
    basis: "24 CFR 5.609(a)(1); 5.100 (earned income)",
    reviewerNote: "A claim that a payment was one-time and should not count (5.609(b)(24)) needs review.",
  },
  self_employment_net: {
    group: "earned",
    treatment: "counted",
    earned: true,
    selfEmployment: true,
    allowsNegative: true,
    label: { en: "Self-employment or business income (net)", es: "Ingresos por cuenta propia o de un negocio (netos)" },
    help: {
      en: "What a business or self-employed work earned after its operating expenses.",
      es: "Lo que ganó un negocio o el trabajo por cuenta propia después de sus gastos de operación.",
    },
    basis: "24 CFR 5.609(b)(28)(i)",
    reviewerNote:
      "Net income only: gross receipts minus operating expenses, straight-line depreciation only, no deduction for business expansion or repayment of capital debt. A tax-return figure may use accelerated depreciation. A net loss is not addressed by the sources and is not subtracted from other income.",
  },
  gig_contractor_daylabor_seasonal: {
    group: "earned",
    treatment: "counted",
    earned: true,
    selfEmployment: true,
    allowsNegative: true,
    label: { en: "Contract, gig, day-labor or seasonal work", es: "Trabajo por contrato, por encargo, por día o de temporada" },
    help: {
      en: "Money from independent contract work, app-based gigs, day labor or seasonal work.",
      es: "Dinero por trabajo independiente, trabajos por aplicación, trabajo por día o de temporada.",
    },
    basis: "24 CFR 5.609(a)(1); 5.609(b)(24), second sentence; 5.603",
    reviewerNote: "Never excludable as nonrecurring income. Net of business expenses when the person is self-employed.",
  },
  business_withdrawals: {
    group: "earned",
    treatment: "review",
    selfEmployment: true,
    audience: "reviewer",
    label: { en: "Money or assets taken out of a business", es: "Dinero o bienes retirados de un negocio" },
    help: {
      en: "Cash or assets an owner took out of a business.",
      es: "Efectivo o bienes que un dueño retiró de un negocio.",
    },
    basis: "24 CFR 5.609(b)(28)(ii)",
    reviewerNote: "Income unless the withdrawal repays cash or assets the family invested in the business. Needs facts.",
  },
  minor_earned_income: {
    group: "earned",
    treatment: "excluded",
    appliesTo: "minor_not_head_or_spouse",
    earned: true,
    label: { en: "Earnings of a child under 18", es: "Ganancias de un menor de 18 años" },
    help: {
      en: "Pay from a job held by a child under 18 who is not the head of the household or the head's spouse.",
      es: "El pago del empleo de un menor de 18 años que no es jefe del hogar ni cónyuge del jefe del hogar.",
    },
    basis: "24 CFR 5.609(b)(3)",
  },
  minor_head_or_spouse_income: {
    group: "earned",
    treatment: "counted",
    appliesTo: "minor_head_or_spouse",
    audience: "reviewer",
    label: { en: "Income of a head of household or spouse under 18", es: "Ingresos de un jefe del hogar o cónyuge menor de 18 años" },
    help: {
      en: "Any income of a person under 18 who is the head of the household or the head's spouse.",
      es: "Cualquier ingreso de una persona menor de 18 años que es jefe del hogar o cónyuge del jefe del hogar.",
    },
    basis: "24 CFR 5.609(a)(1)",
    reviewerNote: "Rare. Confirm that the person really is the head of household or the head's spouse.",
  },
  dependent_ft_student_earned: {
    group: "earned",
    treatment: "counted",
    appliesTo: "dependent_full_time_student",
    earned: true,
    cappedAtDependentDeduction: true,
    label: { en: "Earnings of a full-time student aged 18 or older", es: "Ganancias de un estudiante de tiempo completo de 18 años o más" },
    help: {
      en: "Pay from a job held by a dependent full-time student aged 18 or older; only a small fixed amount of it counts.",
      es: "El pago del empleo de un estudiante dependiente de tiempo completo de 18 años o más; solo cuenta una pequeña cantidad fija.",
    },
    basis: "24 CFR 5.609(b)(14); 5.611(a)(1)",
    reviewerNote:
      "Counted up to the HUD dependent deduction amount per student; the rest is excluded. Does not apply to the head of household or spouse. The amount is $480 as of January 1, 2024 and is adjusted every January 1; later amounts are not in the sources.",
  },
  military_pay_cash: {
    group: "earned",
    treatment: "counted",
    earned: true,
    label: { en: "Military pay and cash allowances", es: "Paga militar y asignaciones en efectivo" },
    help: {
      en: "Armed Forces pay and allowances paid in cash.",
      es: "Paga de las Fuerzas Armadas y asignaciones pagadas en efectivo.",
    },
    basis: "24 CFR 5.609(a)(1)",
    reviewerNote: `Housing or meals provided in kind are non-cash and are not counted (${PROPOSED_HOUSEHOLD_INCOME}).`,
  },
  military_hostile_fire_pay: {
    group: "earned",
    treatment: "excluded",
    earned: true,
    audience: "reviewer",
    label: { en: "Military hostile-fire pay", es: "Paga militar por fuego hostil" },
    help: {
      en: "Special pay to a service member exposed to hostile fire.",
      es: "Paga especial a un militar expuesto a fuego hostil.",
    },
    basis: "24 CFR 5.609(b)(11)",
  },
  census_temp_employment: {
    group: "earned",
    treatment: "excluded",
    earned: true,
    audience: "reviewer",
    label: { en: "Temporary Census Bureau work", es: "Trabajo temporal para la Oficina del Censo" },
    help: {
      en: "Pay from temporary Census Bureau work lasting 180 days or less.",
      es: "El pago por un trabajo temporal para la Oficina del Censo de 180 días o menos.",
    },
    basis: "24 CFR 5.609(b)(24)(i)",
  },
  training_program_earnings: {
    group: "earned",
    treatment: "excluded",
    earned: true,
    audience: "reviewer",
    label: { en: "Job-training program pay (AmeriCorps, WIOA and similar)", es: "Pago de programas de capacitación laboral (AmeriCorps, WIOA y similares)" },
    help: {
      en: "Extra earnings or allowances from a qualifying job-training or national-service program.",
      es: "Ganancias o asignaciones adicionales de un programa calificado de capacitación laboral o de servicio nacional.",
    },
    basis: "24 CFR 5.609(b)(12)(iv); 5.609(b)(22) with 89 FR 6126 items (2), (9), (16), (19)",
    reviewerNote: "The program must be identified. If it is unclear which program paid, classify the item under a review category instead.",
  },
  live_in_aide_income: {
    group: "earned",
    treatment: "excluded",
    appliesTo: "live_in_aide",
    audience: "reviewer",
    label: { en: "Income of a live-in aide", es: "Ingresos de un asistente que vive en el hogar" },
    help: {
      en: "Any income of a live-in aide who lives in the home to care for a household member.",
      es: "Cualquier ingreso de un asistente que vive en el hogar para cuidar a un miembro del hogar.",
    },
    basis: "24 CFR 5.609(b)(8)",
    reviewerNote: "Whether a live-in aide counts toward section 25F family size is not settled by the sources.",
  },
  foster_member_income: {
    group: "earned",
    treatment: "excluded",
    appliesTo: "foster_member",
    audience: "reviewer",
    label: { en: "Income of a foster child or foster adult", es: "Ingresos de un menor o adulto en cuidado de crianza" },
    help: {
      en: "Any income of a foster child or foster adult living in the home.",
      es: "Cualquier ingreso de un menor o adulto en cuidado de crianza que vive en el hogar.",
    },
    basis: "24 CFR 5.609(b)(8)",
    reviewerNote: "A student who is a foster child has a separate proposed safe harbor, which this product does not apply.",
  },
  medicaid_caregiver_payments: {
    group: "earned",
    treatment: "review",
    audience: "reviewer",
    label: { en: "State payments for caring for a household member with a disability", es: "Pagos del estado por cuidar a un miembro del hogar con discapacidad" },
    help: {
      en: "Payments from a State Medicaid or other agency to a family member who cares for a household member with a disability at home.",
      es: "Pagos de Medicaid estatal u otra agencia a un familiar que cuida en casa a un miembro del hogar con discapacidad.",
    },
    basis: "24 CFR 5.609(b)(19)",
    reviewerNote: "Excluded in HUD programs, where the text refers to the family's assisted unit. Whether the exclusion carries into section 25F is not addressed.",
  },

  /* ---------------------------------------------------------- B. Benefits and other periodic cash */
  social_security: {
    group: "benefits",
    treatment: "counted",
    label: { en: "Social Security (retirement, survivors, disability)", es: "Seguro Social (jubilación, sobrevivientes, discapacidad)" },
    help: {
      en: "Social Security retirement, survivors or disability benefits, including a child's benefit.",
      es: "Beneficios del Seguro Social por jubilación, sobrevivientes o discapacidad, incluido el beneficio de un menor.",
    },
    basis: "24 CFR 5.609(a)(1)",
    reviewerNote: "Use the gross benefit before garnishment. Treatment of Medicare premium deductions is not in the sources.",
  },
  ss_ssi_va_lump_sum_backpay: {
    group: "benefits",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Back pay of Social Security, SSI or VA disability", es: "Pagos atrasados del Seguro Social, SSI o discapacidad de VA" },
    help: {
      en: "Delayed Social Security, SSI or VA disability benefits paid as a lump sum or as catch-up payments.",
      es: "Beneficios atrasados del Seguro Social, SSI o discapacidad de VA pagados en una suma global o como pagos de recuperación.",
    },
    basis: "24 CFR 5.609(b)(16); 89 FR 6126 item (22)",
  },
  ssi: {
    group: "benefits",
    treatment: "counted",
    label: { en: "Supplemental Security Income (SSI)", es: "Seguridad de Ingreso Suplementario (SSI)" },
    help: {
      en: "Regular monthly SSI payments.",
      es: "Pagos mensuales regulares de SSI.",
    },
    basis: "24 CFR 5.609(a)(1)",
    reviewerNote: "Amounts set aside under a Plan to Attain Self-Sufficiency are excluded (5.609(b)(12)(i)). An SSI approval letter can also support the categorical method.",
  },
  tanf_cash: {
    group: "benefits",
    treatment: "counted",
    label: { en: "TANF or other cash assistance", es: "TANF u otra asistencia en efectivo" },
    help: {
      en: "Cash assistance such as TANF, including cash paid onto a benefits card.",
      es: "Asistencia en efectivo como TANF, incluido el efectivo depositado en una tarjeta de beneficios.",
    },
    basis: "24 CFR 5.609(a)(1); 5.603 (welfare assistance)",
    reviewerNote: "HUD's imputed welfare income (24 CFR 5.615) is not received in cash and is not counted. A TANF approval letter can also support the categorical method.",
  },
  unemployment: {
    group: "benefits",
    treatment: "counted",
    label: { en: "Unemployment benefits", es: "Beneficios por desempleo" },
    help: {
      en: "Unemployment compensation.",
      es: "Compensación por desempleo.",
    },
    basis: "24 CFR 5.609(a)(1)",
  },
  workers_comp: {
    group: "benefits",
    treatment: "excluded",
    label: { en: "Workers' compensation", es: "Compensación laboral por accidentes de trabajo" },
    help: {
      en: "Workers' compensation payments for a job injury or illness.",
      es: "Pagos de compensación laboral por una lesión o enfermedad de trabajo.",
    },
    basis: "24 CFR 5.609(b)(5)",
  },
  disability_insurance_private: {
    group: "benefits",
    treatment: "review",
    label: { en: "Private disability insurance benefits", es: "Beneficios de un seguro privado por discapacidad" },
    help: {
      en: "Short-term or long-term disability benefits paid by an insurer or employer plan.",
      es: "Beneficios por discapacidad a corto o largo plazo pagados por una aseguradora o un plan del empleador.",
    },
    basis: "24 CFR 5.609(b)(5) (insurance payments for personal losses) versus 5.609(a)(1)",
    reviewerNote: "Not addressed specifically by the sources.",
  },
  pension_annuity: {
    group: "benefits",
    treatment: "counted",
    label: { en: "Pensions and annuities", es: "Pensiones y anualidades" },
    help: {
      en: "Regular pension or annuity payments.",
      es: "Pagos regulares de una pensión o anualidad.",
    },
    basis: "24 CFR 5.609(a)(1)",
  },
  retirement_periodic_distributions: {
    group: "benefits",
    treatment: "counted",
    label: { en: "Regular payments from a retirement account", es: "Pagos regulares de una cuenta de jubilación" },
    help: {
      en: "Regular payments from an IRA, 401(k) or other retirement plan.",
      es: "Pagos regulares de una cuenta IRA, 401(k) u otro plan de jubilación.",
    },
    basis: "24 CFR 5.609(b)(26), proviso",
  },
  retirement_lump_sum_withdrawal: {
    group: "benefits",
    treatment: "review",
    label: { en: "One-time withdrawal from a retirement account", es: "Retiro único de una cuenta de jubilación" },
    help: {
      en: "A single, non-recurring withdrawal from an IRA, 401(k) or other retirement plan.",
      es: "Un retiro único, no recurrente, de una cuenta IRA, 401(k) u otro plan de jubilación.",
    },
    basis: "24 CFR 5.609(b)(26)",
    reviewerNote: "The regulation makes only periodic payments income; a one-time withdrawal is not described.",
  },
  va_compensation_pension: {
    group: "benefits",
    treatment: "counted",
    label: { en: "VA disability compensation or pension", es: "Compensación por discapacidad o pensión de VA" },
    help: {
      en: "Regular VA disability compensation, Veterans Pension or Survivors Pension payments.",
      es: "Pagos regulares de compensación por discapacidad de VA, pensión de veteranos o pensión de sobrevivientes.",
    },
    basis: "24 CFR 5.609(a)(1)",
    reviewerNote: "Only deferred VA disability amounts paid as a lump sum or catch-up are excluded (5.609(b)(16)).",
  },
  va_aid_and_attendance: {
    group: "benefits",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "VA aid and attendance payments", es: "Pagos de ayuda y asistencia de VA" },
    help: {
      en: "VA aid and attendance payments to a veteran.",
      es: "Pagos de ayuda y asistencia de VA a un veterano.",
    },
    basis: "24 CFR 5.609(b)(17)",
    reviewerNote: "Applies to the veteran only, not to survivors.",
  },
  child_support_received: {
    group: "benefits",
    treatment: "counted",
    label: { en: "Child support received", es: "Manutención de menores recibida" },
    help: {
      en: "Child support the household actually received during the year, even though it is not taxed.",
      es: "La manutención de menores que el hogar realmente recibió durante el año, aunque no pague impuestos.",
    },
    basis: `24 CFR 5.609(a)(1); ${PROPOSED_HOUSEHOLD_INCOME}`,
    reviewerNote: "The amount received in the income year, not the amount ordered.",
  },
  alimony_received: {
    group: "benefits",
    treatment: "counted",
    label: { en: "Alimony or spousal support received", es: "Pensión alimenticia o manutención conyugal recibida" },
    help: {
      en: "Alimony or spousal support the household actually received during the year, taxable or not.",
      es: "La pensión alimenticia o manutención conyugal que el hogar realmente recibió durante el año, pague impuestos o no.",
    },
    basis: `24 CFR 5.609(a)(1); ${PROPOSED_HOUSEHOLD_INCOME}`,
  },
  support_paid: {
    group: "benefits",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Child support or alimony paid to someone else", es: "Manutención o pensión alimenticia pagada a otra persona" },
    help: {
      en: "Support a household member paid out; it is recorded but never subtracted from income.",
      es: "Manutención que un miembro del hogar pagó; se registra pero nunca se resta de los ingresos.",
    },
    basis: "No deduction: 24 CFR 5.609 has none and 5.611 is not referenced by the proposed rule",
    reviewerNote: "Never subtract. When wages are garnished to pay support, the gross wage is counted.",
  },
  regular_contributions_from_outside: {
    group: "benefits",
    treatment: "review",
    label: { en: "Regular money from someone outside the household", es: "Dinero regular de alguien fuera del hogar" },
    help: {
      en: "Recurring cash support or gifts from a person who does not live in the home.",
      es: "Apoyo o regalos en efectivo recurrentes de una persona que no vive en el hogar.",
    },
    basis: "24 CFR 5.609(a)(1) (all amounts from all sources) versus 5.609(b)(24)(v)",
    reviewerNote: "Occasion gifts are excluded; recurring support is not listed as excluded, so the default reading is that it counts.",
  },
  adoption_assistance: {
    group: "benefits",
    treatment: "counted",
    cappedAtDependentDeduction: true,
    label: { en: "Adoption assistance payments", es: "Pagos de asistencia por adopción" },
    help: {
      en: "Adoption assistance payments for a child; only a small fixed amount per child counts.",
      es: "Pagos de asistencia por adopción para un menor; solo cuenta una pequeña cantidad fija por menor.",
    },
    basis: "24 CFR 5.609(b)(15); 5.611(a)(1)",
    reviewerNote: "Counted up to the HUD dependent deduction amount per adopted child; the rest is excluded. Enter one item per child.",
  },
  foster_kinship_payments: {
    group: "benefits",
    treatment: "excluded",
    label: { en: "Foster care or kinship care payments", es: "Pagos por cuidado de crianza o cuidado por parientes" },
    help: {
      en: "Payments for the care of foster children or adults, and State or Tribal kinship or guardianship care payments.",
      es: "Pagos por el cuidado de menores o adultos en crianza, y pagos estatales o tribales por cuidado de parientes o tutela.",
    },
    basis: "24 CFR 5.609(b)(4)",
  },
  guaranteed_income_pilot: {
    group: "benefits",
    treatment: "review",
    audience: "reviewer",
    label: { en: "Guaranteed-income pilot or research study payments", es: "Pagos de programas piloto de ingreso garantizado o de estudios de investigación" },
    help: {
      en: "Payments from a guaranteed-income pilot or for taking part in a research study.",
      es: "Pagos de un programa piloto de ingreso garantizado o por participar en un estudio de investigación.",
    },
    basis: "24 CFR 5.609(b)(24)",
    reviewerNote: "HUD looks at whether the payments will continue; how that applies to a completed calendar year is not in the sources.",
  },
  severance_strike_other: {
    group: "benefits",
    treatment: "review",
    label: { en: "Severance, strike pay or other cash not listed", es: "Indemnización por despido, pago de huelga u otro efectivo no listado" },
    help: {
      en: "Severance pay, strike benefits or any other cash received that does not fit another category.",
      es: "Indemnización por despido, beneficios de huelga o cualquier otro efectivo recibido que no corresponda a otra categoría.",
    },
    basis: "24 CFR 5.609(a)(1) (default inclusion) versus 5.609(b)(24)",
    reviewerNote: "The default rule is inclusion unless a paragraph (b) exclusion applies.",
  },

  /* ------------------------------------------------------------ C. Assets and investment income */
  interest_dividends: {
    group: "assets",
    treatment: "counted",
    label: { en: "Interest and dividends", es: "Intereses y dividendos" },
    help: {
      en: "Interest and dividends actually paid during the year, taxable or tax-exempt.",
      es: "Intereses y dividendos realmente pagados durante el año, gravables o exentos.",
    },
    basis: "24 CFR 5.609(a)(1)",
    reviewerNote: "Actual cash returns only.",
  },
  rental_income_net: {
    group: "assets",
    treatment: "counted",
    allowsNegative: true,
    label: { en: "Rental income", es: "Ingresos por alquiler" },
    help: {
      en: "Rent received from property the household owns.",
      es: "Alquiler recibido por una propiedad del hogar.",
    },
    basis: "24 CFR 5.609(a)(1); 5.609(b)(28) when run as a business",
    reviewerNote:
      "Counted. Net of expenses is supported only where the rental is the operation of a business; for a casual landlord the sources do not say whether expenses may be subtracted. Enter net rent as the low figure and gross rent as the high figure.",
  },
  imputed_asset_return: {
    group: "assets",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Imputed return on assets", es: "Rendimiento imputado de los bienes" },
    help: {
      en: "An assumed return on savings or property that was not actually paid; never counted.",
      es: "Un rendimiento supuesto de ahorros o propiedades que no se pagó realmente; nunca se cuenta.",
    },
    basis: `${PROPOSED_HOUSEHOLD_INCOME} (disregards the imputed return on net assets of 24 CFR 5.609(a)(2))`,
    reviewerNote: "Asset values are not collected for this purpose.",
  },
  unrealized_appreciation: {
    group: "assets",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Increase in value of a home, stock or other asset", es: "Aumento de valor de una casa, acciones u otro bien" },
    help: {
      en: "A rise in the value of something the household still owns; never counted.",
      es: "Un aumento en el valor de algo que el hogar todavía posee; nunca se cuenta.",
    },
    basis: PROPOSED_HOUSEHOLD_INCOME,
  },
  realized_capital_gains: {
    group: "assets",
    treatment: "review",
    label: { en: "Gain from selling a home, stock or other asset", es: "Ganancia por la venta de una casa, acciones u otro bien" },
    help: {
      en: "Profit from selling a home, stock or another asset during the year.",
      es: "Ganancia por vender una casa, acciones u otro bien durante el año.",
    },
    basis: "Not addressed by 24 CFR 5.609; see 5.609(b)(24)(vii)",
    reviewerNote: "HUD treats returns as interest and dividends, not the increase in market value. Do not add tax-return capital gains automatically.",
  },
  retirement_account_internal_earnings: {
    group: "assets",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Earnings that stay inside a retirement account", es: "Rendimientos que permanecen dentro de una cuenta de jubilación" },
    help: {
      en: "Growth inside an IRA, 401(k) or other retirement account that was not paid out.",
      es: "El crecimiento dentro de una cuenta IRA, 401(k) u otra cuenta de jubilación que no se pagó.",
    },
    basis: "24 CFR 5.609(b)(26)",
  },
  education_savings_income: {
    group: "assets",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Education savings and ABLE account income", es: "Ingresos de cuentas de ahorro educativo y cuentas ABLE" },
    help: {
      en: "Income and distributions from Coverdell, 529, ABLE and similar accounts.",
      es: "Ingresos y distribuciones de cuentas Coverdell, 529, ABLE y similares.",
    },
    basis: "24 CFR 5.609(b)(10), (b)(27); 89 FR 6126 item (28)",
  },
  trust_distributions: {
    group: "assets",
    treatment: "review",
    audience: "reviewer",
    label: { en: "Trust distributions", es: "Distribuciones de un fideicomiso" },
    help: {
      en: "Money paid to a household member from a trust.",
      es: "Dinero pagado a un miembro del hogar por un fideicomiso.",
    },
    basis: "24 CFR 5.609(b)(2)",
    reviewerNote:
      "Principal is not income. Income distributions from an irrevocable trust count, except for a minor's medical costs. For a revocable trust under the family's control, distributions do not count but the trust's own income does.",
  },

  /* --------------------------------------------------------- D. One-time and lump-sum receipts */
  tax_refunds_credits: {
    group: "one_time",
    treatment: "excluded",
    label: { en: "Tax refunds and refundable tax credits", es: "Reembolsos de impuestos y créditos tributarios reembolsables" },
    help: {
      en: "Federal or State tax refunds and refundable credits such as the earned income credit.",
      es: "Reembolsos de impuestos federales o estatales y créditos reembolsables como el crédito por ingreso del trabajo.",
    },
    basis: "24 CFR 5.609(b)(24)(iii)-(iv); 89 FR 6126 items (13), (14)",
  },
  stimulus_recovery: {
    group: "one_time",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Economic stimulus or recovery payments", es: "Pagos de estímulo o recuperación económica" },
    help: {
      en: "Direct Federal or State payments intended for economic stimulus or recovery.",
      es: "Pagos directos federales o estatales destinados al estímulo o la recuperación económica.",
    },
    basis: "24 CFR 5.609(b)(24)(ii)",
  },
  lottery_inheritance_lump_sum: {
    group: "one_time",
    treatment: "excluded",
    label: { en: "Lottery winnings, inheritance or other one-time lump sum", es: "Premios de lotería, herencia u otra suma global única" },
    help: {
      en: "A one-time lump sum such as lottery or contest winnings or an inheritance.",
      es: "Una suma global única, como premios de lotería o concursos o una herencia.",
    },
    basis: "24 CFR 5.609(b)(24)(vii)",
    reviewerNote:
      "Lottery and contest winnings are named in the regulation. Inheritance is not named; excluding it is an inference from 'lump-sum additions to net family assets'. Record that in the notes. Amounts paid as a multi-year stream need review.",
  },
  insurance_settlements: {
    group: "one_time",
    treatment: "excluded",
    label: { en: "Insurance payments and settlements", es: "Pagos e indemnizaciones de seguros" },
    help: {
      en: "Health, auto or property insurance payments and settlements for a loss.",
      es: "Pagos e indemnizaciones de seguros de salud, auto o propiedad por una pérdida.",
    },
    basis: "24 CFR 5.609(b)(5)",
  },
  injury_civil_settlements: {
    group: "one_time",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Injury or civil-rights settlements", es: "Indemnizaciones por lesiones o por derechos civiles" },
    help: {
      en: "Recoveries for malpractice or negligence that caused a disability, and civil-rights settlements or judgments.",
      es: "Indemnizaciones por mala praxis o negligencia que causó una discapacidad, y acuerdos o sentencias de derechos civiles.",
    },
    basis: "24 CFR 5.609(b)(7), (b)(25)",
  },
  occasion_gifts: {
    group: "one_time",
    treatment: "excluded",
    label: { en: "Gifts for holidays, birthdays and other occasions", es: "Regalos por fiestas, cumpleaños y otras ocasiones" },
    help: {
      en: "Gifts for holidays, birthdays, weddings and other significant life events.",
      es: "Regalos por fiestas, cumpleaños, bodas y otros acontecimientos importantes de la vida.",
    },
    basis: "24 CFR 5.609(b)(24)(v)",
  },
  crowdfunding: {
    group: "one_time",
    treatment: "review",
    label: { en: "Online fundraising", es: "Recaudación de fondos en línea" },
    help: {
      en: "Money raised for the household through an online fundraising page.",
      es: "Dinero recaudado para el hogar mediante una página de recaudación en línea.",
    },
    basis: "24 CFR 5.609(b)(24)(vii)",
    reviewerNote: "HUD guidance treats a one-time receipt as a lump-sum addition to assets and a repeated pattern as income.",
  },
  loan_proceeds: {
    group: "one_time",
    treatment: "excluded",
    label: { en: "Loan proceeds", es: "Dinero de préstamos" },
    help: {
      en: "Money borrowed, such as a student, car or personal loan.",
      es: "Dinero prestado, como un préstamo estudiantil, de auto o personal.",
    },
    basis: "24 CFR 5.609(b)(20)",
  },
  disaster_emergency_aid: {
    group: "one_time",
    treatment: "excluded",
    label: { en: "Disaster or emergency rental assistance", es: "Asistencia por desastre o asistencia de emergencia para alquiler" },
    help: {
      en: "Disaster assistance and emergency rental assistance payments.",
      es: "Pagos de asistencia por desastre y de asistencia de emergencia para alquiler.",
    },
    basis: "24 CFR 5.609(b)(22); 89 FR 6126 items (27), (29)",
  },
  crime_victim_comp: {
    group: "one_time",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Crime victim compensation", es: "Compensación a víctimas de delitos" },
    help: {
      en: "Compensation paid to a victim of crime.",
      es: "Compensación pagada a una víctima de un delito.",
    },
    basis: "24 CFR 5.609(b)(22); 89 FR 6126 item (18)",
    reviewerNote: "Subject to the HUD notice's full-compensation caveat.",
  },
  property_tax_rebates: {
    group: "one_time",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Property tax refunds or rebates", es: "Reembolsos o descuentos del impuesto predial" },
    help: {
      en: "State or local refunds or rebates of property tax paid on the home.",
      es: "Reembolsos o descuentos estatales o locales del impuesto predial pagado por la vivienda.",
    },
    basis: "24 CFR 5.609(b)(18)",
  },
  medical_reimbursements: {
    group: "one_time",
    treatment: "excluded",
    label: { en: "Medical expense payments or reimbursements", es: "Pagos o reembolsos de gastos médicos" },
    help: {
      en: "Amounts paid for, or reimbursing, health and medical care costs.",
      es: "Cantidades pagadas por gastos de salud y atención médica, o que los reembolsan.",
    },
    basis: "24 CFR 5.609(b)(6)",
  },
  program_expense_reimbursements: {
    group: "one_time",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Reimbursed costs of taking part in a public program", es: "Reembolso de gastos por participar en un programa público" },
    help: {
      en: "Reimbursement of out-of-pocket costs for taking part in a publicly assisted program.",
      es: "Reembolso de gastos propios por participar en un programa con asistencia pública.",
    },
    basis: "24 CFR 5.609(b)(12)(ii)",
  },
  tribal_and_special_federal: {
    group: "one_time",
    treatment: "review",
    audience: "reviewer",
    label: { en: "Tribal and special Federal payments", es: "Pagos tribales y pagos federales especiales" },
    help: {
      en: "Tribal trust, per-capita or settlement payments and certain special Federal payments.",
      es: "Pagos tribales de fideicomiso, per cápita o por acuerdos, y ciertos pagos federales especiales.",
    },
    basis: "24 CFR 5.609(b)(13), (b)(21), (b)(23); 89 FR 6126 items (3), (4), (6), (7), (10), (11), (15), (17), (21), (24), (26)",
    reviewerNote: "Mostly excluded, with dollar caps and conditions. Identify the program.",
  },

  /* ---------------------------------------------------------------------- E. Non-cash benefits */
  snap: {
    group: "non_cash",
    treatment: "excluded",
    label: { en: "SNAP (food benefits)", es: "SNAP (beneficios de alimentos)" },
    help: {
      en: "SNAP food benefits; they are not cash income.",
      es: "Beneficios de alimentos de SNAP; no son ingresos en efectivo.",
    },
    basis: `${PROPOSED_HOUSEHOLD_INCOME} (non-cash receipts excluded); 89 FR 6126 item (1)`,
    reviewerNote: "A SNAP approval letter can support the categorical method.",
  },
  wic: {
    group: "non_cash",
    treatment: "excluded",
    label: { en: "WIC", es: "WIC" },
    help: {
      en: "WIC food benefits; they are not cash income.",
      es: "Beneficios de alimentos de WIC; no son ingresos en efectivo.",
    },
    basis: `${PROPOSED_HOUSEHOLD_INCOME} (non-cash receipts excluded); 89 FR 6126 item (20)`,
    reviewerNote: "A WIC approval letter can support the categorical method.",
  },
  school_meals: {
    group: "non_cash",
    treatment: "excluded",
    label: { en: "Free or reduced-price school meals", es: "Comidas escolares gratuitas o a precio reducido" },
    help: {
      en: "Free or reduced-price school meals; they are not cash income.",
      es: "Comidas escolares gratuitas o a precio reducido; no son ingresos en efectivo.",
    },
    basis: "89 FR 6126 item (20)",
    reviewerNote: "School-wide meal eligibility does not support the categorical method under the proposed rules.",
  },
  housing_assistance: {
    group: "non_cash",
    treatment: "excluded",
    label: { en: "Housing assistance (Section 8, public housing, utility allowance)", es: "Asistencia de vivienda (Sección 8, vivienda pública, subsidio de servicios)" },
    help: {
      en: "A Section 8 voucher, public housing subsidy or utility allowance; it is not cash income.",
      es: "Un vale de Sección 8, subsidio de vivienda pública o subsidio de servicios; no es ingreso en efectivo.",
    },
    basis: `${PROPOSED_HOUSEHOLD_INCOME}; preamble to REG-117199-25 (a Section 8 housing allowance is disregarded)`,
    reviewerNote: "Section 8 housing approval can support the categorical method.",
  },
  health_coverage: {
    group: "non_cash",
    treatment: "excluded",
    label: { en: "Health coverage (Medicaid, CHIP, Medicare, insurance subsidies)", es: "Cobertura de salud (Medicaid, CHIP, Medicare, subsidios de seguro)" },
    help: {
      en: "Health coverage and premium subsidies; they are not cash income.",
      es: "Cobertura de salud y subsidios de primas; no son ingresos en efectivo.",
    },
    basis: `24 CFR 5.609(b)(5)-(6); ${PROPOSED_HOUSEHOLD_INCOME} (non-cash receipts excluded)`,
    reviewerNote: "Medicaid and CHIP are not on the proposed categorical program list.",
  },
  liheap_childcare_subsidy: {
    group: "non_cash",
    treatment: "excluded",
    label: { en: "Energy assistance or subsidized child care", es: "Asistencia de energía o cuidado infantil subsidiado" },
    help: {
      en: "Home energy assistance (LIHEAP) and subsidized child care.",
      es: "Asistencia de energía para el hogar (LIHEAP) y cuidado infantil subsidiado.",
    },
    basis: "24 CFR 5.609(b)(22); 89 FR 6126 items (5), (12)",
  },
  employer_noncash_benefits: {
    group: "non_cash",
    treatment: "excluded",
    audience: "reviewer",
    label: { en: "Employer-paid benefits not received in cash", es: "Beneficios pagados por el empleador que no se reciben en efectivo" },
    help: {
      en: "Employer-paid insurance premiums, retirement matches and other benefits not paid in cash.",
      es: "Primas de seguro pagadas por el empleador, aportes de jubilación y otros beneficios que no se pagan en efectivo.",
    },
    basis: `${PROPOSED_HOUSEHOLD_INCOME} (non-cash receipts excluded)`,
  },
  in_kind_donations: {
    group: "non_cash",
    treatment: "excluded",
    label: { en: "Food bank and other in-kind donations", es: "Bancos de alimentos y otras donaciones en especie" },
    help: {
      en: "Food, clothing or other goods received from a food bank or similar organization.",
      es: "Alimentos, ropa u otros bienes recibidos de un banco de alimentos u organización similar.",
    },
    basis: "24 CFR 5.609(b)(24)(vi)",
  },
  higher_ed_student_aid: {
    group: "non_cash",
    treatment: "excluded",
    label: { en: "College grants, scholarships and Federal student aid", es: "Becas universitarias y ayuda federal para estudiantes" },
    help: {
      en: "College grants and scholarships and Federal student aid, including Federal work-study.",
      es: "Becas universitarias y ayuda federal para estudiantes, incluido el trabajo-estudio federal.",
    },
    basis: "24 CFR 5.609(b)(9); 89 FR 6126 item (8)",
    reviewerNote: "Excluded up to the student's actual covered costs. Aid above those costs, and fee-for-service aid outside section 479B, is income: review a large amount.",
  },
  k12_scholarships: {
    group: "non_cash",
    treatment: "review",
    label: { en: "K-12 scholarships", es: "Becas de educación primaria y secundaria" },
    help: {
      en: "A K-12 scholarship received during the year, including one from a scholarship granting organization.",
      es: "Una beca de educación primaria o secundaria recibida durante el año, incluida una de una organización que otorga becas.",
    },
    basis: "Not addressed: 24 CFR 5.609(b)(9) covers higher education only; section 139K is a tax exclusion",
    reviewerNote: "A scholarship paid to a school or vendor is not cash received by a household member.",
  },
} as const satisfies Record<string, CategoryRow>;

export type IncomeCategoryKey = keyof typeof ROWS;

function build(key: IncomeCategoryKey, row: CategoryRow): IncomeCategory {
  return Object.freeze({
    key,
    group: row.group,
    treatment: row.treatment,
    appliesTo: row.appliesTo ?? "household",
    earned: row.earned ?? false,
    selfEmployment: row.selfEmployment ?? false,
    cappedAtDependentDeduction: row.cappedAtDependentDeduction ?? false,
    allowsNegative: row.allowsNegative ?? false,
    audience: row.audience ?? "family",
    label: Object.freeze({ ...row.label }),
    help: Object.freeze({ ...row.help }),
    basis: row.basis,
    reviewerNote: row.reviewerNote ?? null,
  });
}

/** Every category, in the order of the research table (earned, benefits, assets, one-time, non-cash). */
export const INCOME_CATEGORIES: readonly IncomeCategory[] = Object.freeze(
  (Object.keys(ROWS) as IncomeCategoryKey[]).map((key) => build(key, ROWS[key])),
);

const BY_KEY: ReadonlyMap<string, IncomeCategory> = new Map(INCOME_CATEGORIES.map((category) => [category.key, category]));

export const INCOME_CATEGORY_KEYS: readonly IncomeCategoryKey[] = Object.freeze(INCOME_CATEGORIES.map((category) => category.key));

export function isIncomeCategoryKey(value: unknown): value is IncomeCategoryKey {
  return typeof value === "string" && BY_KEY.has(value);
}

/** The category for a stored key, or null for a key this taxonomy version does not know. Never throws. */
export function getIncomeCategory(key: string): IncomeCategory | null {
  return BY_KEY.get(key) ?? null;
}

export interface ListIncomeCategoriesFilter {
  audience?: IncomeCategoryAudience;
  group?: IncomeCategoryGroup;
  treatment?: IncomeTreatment;
}

/** Categories in registry order, e.g. `{ audience: "family" }` for the intake form. */
export function listIncomeCategories(filter: ListIncomeCategoriesFilter = {}): IncomeCategory[] {
  return INCOME_CATEGORIES.filter(
    (category) =>
      (filter.audience === undefined || category.audience === filter.audience) &&
      (filter.group === undefined || category.group === filter.group) &&
      (filter.treatment === undefined || category.treatment === filter.treatment),
  );
}

/** Display label for a stored key; an unknown key is shown as it is stored. */
export function incomeCategoryLabel(key: string, locale: IncomeLocale = "en"): string {
  return BY_KEY.get(key)?.label[locale] ?? key;
}

export const INCOME_GROUP_LABELS: Readonly<Record<IncomeCategoryGroup, Localized>> = Object.freeze({
  earned: { en: "Work and business", es: "Trabajo y negocios" },
  benefits: { en: "Benefits and regular payments", es: "Beneficios y pagos regulares" },
  assets: { en: "Savings, investments and property", es: "Ahorros, inversiones y propiedades" },
  one_time: { en: "One-time payments", es: "Pagos únicos" },
  non_cash: { en: "Benefits not paid in cash", es: "Beneficios que no se pagan en efectivo" },
});

export const INCOME_TREATMENT_LABELS: Readonly<Record<IncomeTreatment, Localized>> = Object.freeze({
  counted: { en: "Counted", es: "Se cuenta" },
  excluded: { en: "Not counted", es: "No se cuenta" },
  review: { en: "Needs review", es: "Requiere revisión" },
});

/**
 * Rules that apply to the computation as a whole (section F of the research table). Printed in the
 * evidence pack next to the per-category treatments.
 */
export const INCOME_STRUCTURAL_RULES = Object.freeze([
  {
    key: "no_deductions",
    rule: "No deductions are taken for dependents, child care, medical costs, elderly or disabled members, taxes, or support paid.",
    basis: `24 CFR 5.611 is not referenced by ${PROPOSED_HOUSEHOLD_INCOME}`,
  },
  {
    key: "period",
    rule: "Cash actually received from January 1 to December 31 of the calendar year before the application date. Nothing is projected.",
    basis: "26 U.S.C. 25F(c)(2)(A)",
  },
  {
    key: "whose_income",
    rule: "Every household member aged 18 or older; the head of household or the head's spouse at any age; unearned income of dependents under 18. The household is everyone residing with the student.",
    basis: "24 CFR 5.609(a)(1); Prop. Reg. 1.25F-1(a)(4)(iii)",
  },
  {
    key: "cash_only",
    rule: "Non-cash receipts and the imputed return on net assets are not counted. Child support and alimony received are counted even when they are not in taxable income. Adjusted gross income is never the answer.",
    basis: PROPOSED_HOUSEHOLD_INCOME,
  },
  {
    key: "comparison",
    rule: "The household passes when its income is less than or equal to the limit.",
    basis: "26 U.S.C. 25F(c)(2)(A) (\"not greater than\")",
  },
] as const);

/**
 * HUD dependent deduction (24 CFR 5.611(a)(1)), the cap used by 5.609(b)(14) and (b)(15), by income year.
 *
 * The regulation's base amount is $480, in effect from January 1, 2024, adjusted by HUD every January 1.
 * The adjusted amounts for 2025 and later are NOT in the research sources, so only 2024 is listed. For a
 * year that is not listed the engine does not guess: the capped item's full amount goes into the upper
 * bound of household income and nothing into the lower bound. Add a year here only from HUD's published
 * inflation-adjustment notice.
 */
export const DEPENDENT_DEDUCTION_CENTS_BY_INCOME_YEAR: Readonly<Record<number, number>> = Object.freeze({ 2024: 48_000 });

export function dependentDeductionCents(incomeYear: number): number | null {
  return DEPENDENT_DEDUCTION_CENTS_BY_INCOME_YEAR[incomeYear] ?? null;
}

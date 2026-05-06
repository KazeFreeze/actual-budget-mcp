export interface Account {
  id: string;
  name: string;
  type?: string;
  offbudget?: boolean;
  closed?: boolean;
}

export interface Category {
  id: string;
  name: string;
  group_id: string;
  is_income?: boolean;
  hidden?: boolean;
}

export interface CategoryGroup {
  id: string;
  name: string;
  is_income?: boolean;
  categories?: Category[];
}

export interface Payee {
  id: string;
  name: string;
  transfer_acct?: string | null;
}

export interface Transaction {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee?: string | null;
  category?: string | null;
  notes?: string | null;
  cleared?: boolean;
  reconciled?: boolean;
  imported_id?: string | null;
  subtransactions?: Transaction[];
}

export interface Note {
  id: string;
  note: string;
}

export interface Tag {
  id: string;
  tag: string;
  color?: string | null;
  description?: string | null;
}

export interface BudgetMonth {
  month: string;
  incomeAvailable: number;
  lastMonthOverspent: number;
  forNextMonth: number;
  totalBudgeted: number;
  toBudget: number;
  fromLastMonth: number;
  totalIncome: number;
  totalSpent: number;
  totalBalance: number;
  categoryGroups: Array<{
    id: string;
    name: string;
    is_income: boolean;
    budgeted: number;
    spent: number;
    balance: number;
    categories: Array<{
      id: string;
      name: string;
      is_income: boolean;
      hidden: boolean;
      budgeted: number;
      spent: number;
      balance: number;
      carryover?: boolean;
    }>;
  }>;
}

export interface ScheduleRecurConfig {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  patterns?: Array<{
    value: number;
    type: 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'day';
  }>;
  skipWeekend?: boolean;
  start: string;
  endMode?: 'never' | 'after_n_occurrences' | 'on_date';
  endOccurrences?: number;
  endDate?: string;
  weekendSolveMode?: 'before' | 'after';
}

export type ScheduleAmount = number | { num1: number; num2: number };
export type ScheduleAmountOp = 'is' | 'isapprox' | 'isbetween';

/**
 * External (flat) schedule shape — matches `APIScheduleEntity` in
 * `@actual-app/core`. NOTE: `name` is `string | undefined` (NOT
 * `string | null`) per the SDK type. Server-managed fields (`rule`,
 * `next_date`, `completed`) are returned by reads but should not be
 * supplied by callers on create/update.
 */
export interface Schedule {
  id: string;
  name?: string;
  posts_transaction: boolean;
  rule?: string;
  next_date?: string;
  completed?: boolean;
  payee?: string;
  account?: string;
  amount?: ScheduleAmount;
  amountOp: ScheduleAmountOp;
  date: ScheduleRecurConfig | string;
}

export interface Rule {
  id: string;
  stage: string | null;
  conditionsOp: 'and' | 'or';
  conditions: unknown[];
  actions: unknown[];
}

export interface ActualClient {
  // lifecycle
  init(): Promise<void>;
  shutdown(): Promise<void>;
  sync(): Promise<void>;

  // raw query
  runQuery<T = unknown>(query: unknown): Promise<T>;

  // categories
  getCategories(): Promise<Category[]>;
  createCategory(input: Omit<Category, 'id'>): Promise<string>;
  updateCategory(id: string, fields: Partial<Omit<Category, 'id'>>): Promise<void>;
  deleteCategory(id: string, transferCategoryId?: string): Promise<void>;
  getCategoryGroups(): Promise<CategoryGroup[]>;
  createCategoryGroup(input: Omit<CategoryGroup, 'id' | 'categories'>): Promise<string>;
  updateCategoryGroup(
    id: string,
    fields: Partial<Omit<CategoryGroup, 'id' | 'categories'>>,
  ): Promise<void>;
  deleteCategoryGroup(id: string, transferCategoryId?: string): Promise<void>;

  // accounts
  getAccounts(): Promise<Account[]>;
  createAccount(input: Omit<Account, 'id'>, initialBalance?: number): Promise<string>;
  updateAccount(id: string, fields: Partial<Omit<Account, 'id'>>): Promise<void>;
  closeAccount(id: string, transferAccountId?: string, transferCategoryId?: string): Promise<void>;
  reopenAccount(id: string): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  getAccountBalance(id: string, cutoff?: Date): Promise<number>;
  runBankSync(accountId?: string): Promise<void>;

  // transactions
  getTransactions(accountId: string, sinceDate: string, untilDate: string): Promise<Transaction[]>;
  // NOTE: the underlying SDK handler `api/transactions-add` returns the literal
  // string "ok" rather than any new id(s). We honestly type the adapter as
  // `Promise<void>` and discard that token. Callers needing the new ids should
  // re-query via `getTransactions`.
  addTransactions(
    accountId: string,
    transactions: Omit<Transaction, 'id'>[],
    opts?: { learnCategories?: boolean; runTransfers?: boolean },
  ): Promise<void>;
  importTransactions(
    accountId: string,
    transactions: Omit<Transaction, 'id'>[],
  ): Promise<{ added: string[]; updated: string[] }>;
  updateTransaction(id: string, fields: Partial<Omit<Transaction, 'id'>>): Promise<void>;
  deleteTransaction(id: string): Promise<void>;

  // payees
  getPayees(): Promise<Payee[]>;
  createPayee(input: Omit<Payee, 'id'>): Promise<string>;
  updatePayee(id: string, fields: Partial<Omit<Payee, 'id'>>): Promise<void>;
  deletePayee(id: string): Promise<void>;
  mergePayees(targetId: string, mergeIds: string[]): Promise<void>;
  getCommonPayees(): Promise<Payee[]>;

  // rules
  getRules(): Promise<Rule[]>;
  getPayeeRules(payeeId: string): Promise<Rule[]>;
  createRule(rule: Omit<Rule, 'id'>): Promise<Rule>;
  updateRule(rule: Rule): Promise<Rule>;
  deleteRule(id: string): Promise<void>;

  // budget month
  getBudgetMonth(month: string): Promise<BudgetMonth>;
  getBudgetMonths(): Promise<string[]>;
  setBudgetAmount(month: string, categoryId: string, value: number): Promise<void>;
  setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void>;
  holdBudgetForNextMonth(month: string, amount: number): Promise<void>;
  resetBudgetHold(month: string): Promise<void>;

  // schedules
  getSchedules(): Promise<Schedule[]>;
  createSchedule(input: Omit<Schedule, 'id' | 'rule' | 'next_date' | 'completed'>): Promise<string>;
  // NOTE: SDK returns Promise<string> (the schedule id) but we discard
  // it — matches the updateRule pattern where the caller already has the id.
  updateSchedule(
    id: string,
    fields: Partial<Omit<Schedule, 'id' | 'rule' | 'next_date' | 'completed'>>,
    resetNextDate?: boolean,
  ): Promise<void>;
  deleteSchedule(id: string): Promise<void>;

  // notes (NEW — fixed in v2)
  getNote(id: string): Promise<string | null>;
  setNote(id: string, note: string): Promise<void>;
  deleteNote(id: string): Promise<void>;

  // tags (NEW)
  getTags(): Promise<Tag[]>;
  createTag(tag: Omit<Tag, 'id'>): Promise<string>;
  updateTag(id: string, fields: Partial<Omit<Tag, 'id'>>): Promise<void>;
  deleteTag(id: string): Promise<void>;

  // preferences
  /**
   * Read the budget's `defaultCurrencyCode` synced preference (ISO 4217,
   * e.g. "USD", "PHP", "EUR"). Returns `null` if the preference is missing,
   * empty, or the underlying SDK call fails — callers should fall back to a
   * default symbol rather than treat this as a hard error.
   */
  getCurrencyCode(): Promise<string | null>;
}

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

export interface Schedule {
  id: string;
  rule: string;
  active: boolean;
  completed: boolean;
  posts_transaction: boolean;
  name: string | null;
  next_date: string;
  _date?: unknown;
  _conditions?: unknown;
  _actions?: unknown;
  _account?: string | null;
  _amount?: number;
  _payee?: string | null;
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
  addTransactions(
    accountId: string,
    transactions: Omit<Transaction, 'id'>[],
    opts?: { learnCategories?: boolean; runTransfers?: boolean },
  ): Promise<string>;
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

  // notes (NEW — fixed in v2)
  getNote(id: string): Promise<string | null>;
  setNote(id: string, note: string): Promise<void>;
  deleteNote(id: string): Promise<void>;

  // tags (NEW)
  getTags(): Promise<Tag[]>;
  createTag(tag: Omit<Tag, 'id'>): Promise<Tag>;
  updateTag(id: string, fields: Partial<Omit<Tag, 'id'>>): Promise<void>;
  deleteTag(id: string): Promise<void>;
}

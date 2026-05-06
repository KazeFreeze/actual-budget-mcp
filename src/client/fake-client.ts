import crypto from 'node:crypto';
import type {
  ActualClient,
  Account,
  Category,
  CategoryGroup,
  Payee,
  Transaction,
  Tag,
  BudgetMonth,
  Schedule,
  Rule,
} from './actual-client.js';

const uuid = (): string => crypto.randomUUID();

export class FakeActualClient implements ActualClient {
  syncCount = 0;
  private nextSyncError: Error | null = null;

  private readonly accounts = new Map<string, Account>();
  private readonly categories = new Map<string, Category>();
  private readonly categoryGroups = new Map<string, CategoryGroup>();
  private readonly payees = new Map<string, Payee>();
  private readonly transactions = new Map<string, Transaction>();
  private readonly notes = new Map<string, string>();
  private readonly tags = new Map<string, Tag>();
  private readonly rules = new Map<string, Rule>();
  private readonly schedules = new Map<string, Schedule>();
  private readonly budgetMonths = new Map<string, BudgetMonth>();

  failNextSyncWith(err: Error): void {
    this.nextSyncError = err;
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  sync(): Promise<void> {
    this.syncCount++;
    if (this.nextSyncError) {
      const e = this.nextSyncError;
      this.nextSyncError = null;
      return Promise.reject(e);
    }
    return Promise.resolve();
  }

  runQuery<T = unknown>(_query: unknown): Promise<T> {
    return Promise.resolve([] as unknown as T);
  }

  // categories
  getCategories(): Promise<Category[]> {
    return Promise.resolve([...this.categories.values()]);
  }

  createCategory(input: Omit<Category, 'id'>): Promise<string> {
    const id = uuid();
    this.categories.set(id, { id, ...input });
    return Promise.resolve(id);
  }

  updateCategory(id: string, fields: Partial<Omit<Category, 'id'>>): Promise<void> {
    const cur = this.categories.get(id);
    if (!cur) throw new Error(`unknown category ${id}`);
    this.categories.set(id, { ...cur, ...fields });
    return Promise.resolve();
  }

  deleteCategory(id: string, _transferCategoryId?: string): Promise<void> {
    this.categories.delete(id);
    return Promise.resolve();
  }

  getCategoryGroups(): Promise<CategoryGroup[]> {
    return Promise.resolve([...this.categoryGroups.values()]);
  }

  createCategoryGroup(input: Omit<CategoryGroup, 'id' | 'categories'>): Promise<string> {
    const id = uuid();
    this.categoryGroups.set(id, { id, ...input, categories: [] });
    return Promise.resolve(id);
  }

  updateCategoryGroup(
    id: string,
    fields: Partial<Omit<CategoryGroup, 'id' | 'categories'>>,
  ): Promise<void> {
    const cur = this.categoryGroups.get(id);
    if (!cur) throw new Error(`unknown group ${id}`);
    this.categoryGroups.set(id, { ...cur, ...fields });
    return Promise.resolve();
  }

  deleteCategoryGroup(id: string, _transferCategoryId?: string): Promise<void> {
    this.categoryGroups.delete(id);
    return Promise.resolve();
  }

  // accounts
  getAccounts(): Promise<Account[]> {
    return Promise.resolve([...this.accounts.values()]);
  }

  createAccount(input: Omit<Account, 'id'>, _initialBalance?: number): Promise<string> {
    const id = uuid();
    this.accounts.set(id, { id, ...input });
    return Promise.resolve(id);
  }

  updateAccount(id: string, fields: Partial<Omit<Account, 'id'>>): Promise<void> {
    const cur = this.accounts.get(id);
    if (!cur) throw new Error(`unknown account ${id}`);
    this.accounts.set(id, { ...cur, ...fields });
    return Promise.resolve();
  }

  closeAccount(
    id: string,
    _transferAccountId?: string,
    _transferCategoryId?: string,
  ): Promise<void> {
    const cur = this.accounts.get(id);
    if (cur) this.accounts.set(id, { ...cur, closed: true });
    return Promise.resolve();
  }

  reopenAccount(id: string): Promise<void> {
    const cur = this.accounts.get(id);
    if (cur) this.accounts.set(id, { ...cur, closed: false });
    return Promise.resolve();
  }

  deleteAccount(id: string): Promise<void> {
    this.accounts.delete(id);
    return Promise.resolve();
  }

  getAccountBalance(id: string, cutoff?: Date): Promise<number> {
    let sum = 0;
    for (const t of this.transactions.values()) {
      if (t.account !== id) continue;
      if (cutoff !== undefined && new Date(t.date) > cutoff) continue;
      sum += t.amount;
    }
    return Promise.resolve(sum);
  }

  runBankSync(_accountId?: string): Promise<void> {
    return Promise.resolve();
  }

  // transactions
  getTransactions(accountId: string, sinceDate: string, untilDate: string): Promise<Transaction[]> {
    return Promise.resolve(
      [...this.transactions.values()].filter(
        (t) => t.account === accountId && t.date >= sinceDate && t.date <= untilDate,
      ),
    );
  }

  addTransactions(
    accountId: string,
    transactions: Omit<Transaction, 'id'>[],
    _opts?: { learnCategories?: boolean; runTransfers?: boolean },
  ): Promise<void> {
    for (const t of transactions) {
      const id = uuid();
      this.transactions.set(id, { ...t, id, account: accountId });
    }
    return Promise.resolve();
  }

  importTransactions(
    accountId: string,
    transactions: Omit<Transaction, 'id'>[],
  ): Promise<{ added: string[]; updated: string[] }> {
    const added: string[] = [];
    for (const t of transactions) {
      const id = uuid();
      this.transactions.set(id, { ...t, id, account: accountId });
      added.push(id);
    }
    return Promise.resolve({ added, updated: [] });
  }

  updateTransaction(id: string, fields: Partial<Omit<Transaction, 'id'>>): Promise<void> {
    const cur = this.transactions.get(id);
    if (!cur) throw new Error(`unknown tx ${id}`);
    this.transactions.set(id, { ...cur, ...fields });
    return Promise.resolve();
  }

  deleteTransaction(id: string): Promise<void> {
    this.transactions.delete(id);
    return Promise.resolve();
  }

  // payees
  getPayees(): Promise<Payee[]> {
    return Promise.resolve([...this.payees.values()]);
  }

  createPayee(input: Omit<Payee, 'id'>): Promise<string> {
    const id = uuid();
    this.payees.set(id, { id, ...input });
    return Promise.resolve(id);
  }

  updatePayee(id: string, fields: Partial<Omit<Payee, 'id'>>): Promise<void> {
    const cur = this.payees.get(id);
    if (!cur) throw new Error(`unknown payee ${id}`);
    this.payees.set(id, { ...cur, ...fields });
    return Promise.resolve();
  }

  deletePayee(id: string): Promise<void> {
    this.payees.delete(id);
    return Promise.resolve();
  }

  mergePayees(targetId: string, mergeIds: string[]): Promise<void> {
    for (const id of mergeIds) this.payees.delete(id);
    if (!this.payees.has(targetId)) throw new Error(`unknown target payee ${targetId}`);
    return Promise.resolve();
  }

  getCommonPayees(): Promise<Payee[]> {
    return this.getPayees();
  }

  // rules
  getRules(): Promise<Rule[]> {
    return Promise.resolve([...this.rules.values()]);
  }

  getPayeeRules(_payeeId: string): Promise<Rule[]> {
    return Promise.resolve([]);
  }

  createRule(rule: Omit<Rule, 'id'>): Promise<Rule> {
    const id = uuid();
    const full: Rule = { id, ...rule };
    this.rules.set(id, full);
    return Promise.resolve(full);
  }

  updateRule(rule: Rule): Promise<Rule> {
    this.rules.set(rule.id, rule);
    return Promise.resolve(rule);
  }

  deleteRule(id: string): Promise<void> {
    this.rules.delete(id);
    return Promise.resolve();
  }

  // budget
  getBudgetMonth(month: string): Promise<BudgetMonth> {
    return Promise.resolve(
      this.budgetMonths.get(month) ?? {
        month,
        incomeAvailable: 0,
        lastMonthOverspent: 0,
        forNextMonth: 0,
        totalBudgeted: 0,
        toBudget: 0,
        fromLastMonth: 0,
        totalIncome: 0,
        totalSpent: 0,
        totalBalance: 0,
        categoryGroups: [],
      },
    );
  }

  getBudgetMonths(): Promise<string[]> {
    return Promise.resolve([...this.budgetMonths.keys()]);
  }

  setBudgetAmount(_month: string, _categoryId: string, _value: number): Promise<void> {
    return Promise.resolve();
  }

  setBudgetCarryover(_month: string, _categoryId: string, _flag: boolean): Promise<void> {
    return Promise.resolve();
  }

  holdBudgetForNextMonth(_month: string, _amount: number): Promise<void> {
    return Promise.resolve();
  }

  resetBudgetHold(_month: string): Promise<void> {
    return Promise.resolve();
  }

  // schedules
  getSchedules(): Promise<Schedule[]> {
    return Promise.resolve([...this.schedules.values()]);
  }

  createSchedule(
    input: Omit<Schedule, 'id' | 'rule' | 'next_date' | 'completed'>,
  ): Promise<string> {
    const id = uuid();
    const stored: Schedule = {
      id,
      posts_transaction: input.posts_transaction,
      amountOp: input.amountOp,
      date: input.date,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.payee !== undefined ? { payee: input.payee } : {}),
      ...(input.account !== undefined ? { account: input.account } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
    };
    this.schedules.set(id, stored);
    return Promise.resolve(id);
  }

  updateSchedule(
    id: string,
    fields: Partial<Omit<Schedule, 'id' | 'rule' | 'next_date' | 'completed'>>,
    resetNextDate?: boolean,
  ): Promise<void> {
    const cur = this.schedules.get(id);
    if (!cur) throw new Error(`unknown schedule ${id}`);
    const next: Schedule = { ...cur };
    if (fields.name !== undefined) next.name = fields.name;
    if (fields.posts_transaction !== undefined) next.posts_transaction = fields.posts_transaction;
    if (fields.amountOp !== undefined) next.amountOp = fields.amountOp;
    if (fields.date !== undefined) next.date = fields.date;
    if (fields.payee !== undefined) next.payee = fields.payee;
    if (fields.account !== undefined) next.account = fields.account;
    if (fields.amount !== undefined) next.amount = fields.amount;
    if (resetNextDate === true) {
      delete next.next_date;
    }
    this.schedules.set(id, next);
    return Promise.resolve();
  }

  deleteSchedule(id: string): Promise<void> {
    this.schedules.delete(id);
    return Promise.resolve();
  }

  // notes
  getNote(id: string): Promise<string | null> {
    return Promise.resolve(this.notes.get(id) ?? null);
  }

  setNote(id: string, note: string): Promise<void> {
    this.notes.set(id, note);
    return Promise.resolve();
  }

  deleteNote(id: string): Promise<void> {
    this.notes.delete(id);
    return Promise.resolve();
  }

  // tags
  getTags(): Promise<Tag[]> {
    return Promise.resolve([...this.tags.values()]);
  }

  createTag(tag: Omit<Tag, 'id'>): Promise<string> {
    const id = uuid();
    const full: Tag = { id, ...tag };
    this.tags.set(id, full);
    return Promise.resolve(id);
  }

  updateTag(id: string, fields: Partial<Omit<Tag, 'id'>>): Promise<void> {
    const cur = this.tags.get(id);
    if (!cur) throw new Error(`unknown tag ${id}`);
    this.tags.set(id, { ...cur, ...fields });
    return Promise.resolve();
  }

  deleteTag(id: string): Promise<void> {
    this.tags.delete(id);
    return Promise.resolve();
  }

  // helpers for tests
  seedAccount(a: Account): void {
    this.accounts.set(a.id, a);
  }

  seedCategory(c: Category): void {
    this.categories.set(c.id, c);
  }

  seedTransaction(t: Transaction): void {
    this.transactions.set(t.id, t);
  }

  seedNote(id: string, note: string): void {
    this.notes.set(id, note);
  }

  seedCategoryGroup(g: CategoryGroup): void {
    this.categoryGroups.set(g.id, g);
  }

  seedBudgetMonth(m: BudgetMonth): void {
    this.budgetMonths.set(m.month, m);
  }
}

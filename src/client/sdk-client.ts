import * as api from '@actual-app/api';
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

export interface SdkActualClientOptions {
  dataDir: string;
  serverURL: string;
  password: string;
  syncId: string;
  encryptionPassword?: string;
}

export class SdkActualClient implements ActualClient {
  private initialized = false;

  constructor(private readonly opts: SdkActualClientOptions) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    await api.init({
      dataDir: this.opts.dataDir,
      serverURL: this.opts.serverURL,
      password: this.opts.password,
    });
    await api.downloadBudget(
      this.opts.syncId,
      this.opts.encryptionPassword ? { password: this.opts.encryptionPassword } : undefined,
    );
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await api.shutdown();
    this.initialized = false;
  }

  async sync(): Promise<void> {
    await api.sync();
  }

  async runQuery<T>(query: unknown): Promise<T> {
    return (await api.aqlQuery(query as Parameters<typeof api.aqlQuery>[0])) as T;
  }

  // ---- categories
  async getCategories(options?: { hidden?: boolean }): Promise<Category[]> {
    return (await api.getCategories(options)) as Category[];
  }
  async createCategory(input: Omit<Category, 'id'>): Promise<string> {
    return api.createCategory(input);
  }
  async updateCategory(id: string, fields: Partial<Omit<Category, 'id'>>): Promise<void> {
    await api.updateCategory(id, fields);
  }
  async deleteCategory(id: string, transferCategoryId?: string): Promise<void> {
    await api.deleteCategory(id, transferCategoryId);
  }
  async getCategoryGroups(options?: { hidden?: boolean }): Promise<CategoryGroup[]> {
    return await api.getCategoryGroups(options);
  }
  async createCategoryGroup(input: Omit<CategoryGroup, 'id' | 'categories'>): Promise<string> {
    return api.createCategoryGroup(input);
  }
  async updateCategoryGroup(
    id: string,
    fields: Partial<Omit<CategoryGroup, 'id' | 'categories'>>,
  ): Promise<void> {
    await api.updateCategoryGroup(id, fields);
  }
  async deleteCategoryGroup(id: string, transferCategoryId?: string): Promise<void> {
    await api.deleteCategoryGroup(id, transferCategoryId);
  }

  // ---- accounts
  async getAccounts(): Promise<Account[]> {
    return await api.getAccounts();
  }
  async createAccount(input: Omit<Account, 'id'>, initialBalance = 0): Promise<string> {
    return api.createAccount(input, initialBalance);
  }
  async updateAccount(id: string, fields: Partial<Omit<Account, 'id'>>): Promise<void> {
    await api.updateAccount(id, fields);
  }
  async closeAccount(
    id: string,
    transferAccountId?: string,
    transferCategoryId?: string,
  ): Promise<void> {
    await api.closeAccount(id, transferAccountId, transferCategoryId);
  }
  async reopenAccount(id: string): Promise<void> {
    await api.reopenAccount(id);
  }
  async deleteAccount(id: string): Promise<void> {
    await api.deleteAccount(id);
  }
  async getAccountBalance(id: string, cutoff?: Date): Promise<number> {
    return api.getAccountBalance(id, cutoff);
  }
  async runBankSync(accountId?: string): Promise<void> {
    await api.runBankSync(accountId ? { accountId } : undefined);
  }

  // ---- transactions
  async getTransactions(accountId: string, since: string, until: string): Promise<Transaction[]> {
    return await api.getTransactions(accountId, since, until);
  }
  async addTransactions(
    accountId: string,
    txs: Omit<Transaction, 'id'>[],
    opts?: { learnCategories?: boolean; runTransfers?: boolean },
  ): Promise<void> {
    // SDK handler returns the literal string "ok"; we discard it.
    await api.addTransactions(accountId, txs as Parameters<typeof api.addTransactions>[1], opts);
  }
  async importTransactions(
    accountId: string,
    txs: Omit<Transaction, 'id'>[],
  ): Promise<{ added: string[]; updated: string[] }> {
    return api.importTransactions(accountId, txs as Parameters<typeof api.importTransactions>[1]);
  }
  async updateTransaction(id: string, fields: Partial<Omit<Transaction, 'id'>>): Promise<void> {
    await api.updateTransaction(id, fields as Parameters<typeof api.updateTransaction>[1]);
  }
  async deleteTransaction(id: string): Promise<void> {
    await api.deleteTransaction(id);
  }

  // ---- payees
  async getPayees(): Promise<Payee[]> {
    return await api.getPayees();
  }
  async createPayee(input: Omit<Payee, 'id'>): Promise<string> {
    return api.createPayee(input as Parameters<typeof api.createPayee>[0]);
  }
  async updatePayee(id: string, fields: Partial<Omit<Payee, 'id'>>): Promise<void> {
    await api.updatePayee(id, fields as Parameters<typeof api.updatePayee>[1]);
  }
  async deletePayee(id: string): Promise<void> {
    await api.deletePayee(id);
  }
  async mergePayees(targetId: string, mergeIds: string[]): Promise<void> {
    await api.mergePayees(targetId, mergeIds);
  }
  async getCommonPayees(): Promise<Payee[]> {
    return await api.getCommonPayees();
  }

  // ---- rules
  async getRules(): Promise<Rule[]> {
    return await api.getRules();
  }
  async getPayeeRules(payeeId: string): Promise<Rule[]> {
    return await api.getPayeeRules(payeeId);
  }
  async createRule(rule: Omit<Rule, 'id'>): Promise<Rule> {
    return await api.createRule(rule as Parameters<typeof api.createRule>[0]);
  }
  async updateRule(rule: Rule): Promise<Rule> {
    return await api.updateRule(rule as Parameters<typeof api.updateRule>[0]);
  }
  async deleteRule(id: string): Promise<void> {
    await api.deleteRule(id);
  }

  // ---- budget
  async getBudgetMonth(month: string): Promise<BudgetMonth> {
    return (await api.getBudgetMonth(month)) as BudgetMonth;
  }
  async getBudgetMonths(): Promise<string[]> {
    const months = await api.getBudgetMonths();
    return months.map((m: { month: string } | string) => (typeof m === 'string' ? m : m.month));
  }
  async setBudgetAmount(month: string, categoryId: string, value: number): Promise<void> {
    await api.setBudgetAmount(month, categoryId, value);
  }
  async setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void> {
    await api.setBudgetCarryover(month, categoryId, flag);
  }
  async holdBudgetForNextMonth(month: string, amount: number): Promise<void> {
    await api.holdBudgetForNextMonth(month, amount);
  }
  async resetBudgetHold(month: string): Promise<void> {
    await api.resetBudgetHold(month);
  }

  // ---- schedules
  async getSchedules(): Promise<Schedule[]> {
    return await api.getSchedules();
  }
  async createSchedule(
    input: Omit<Schedule, 'id' | 'rule' | 'next_date' | 'completed'>,
  ): Promise<string> {
    return api.createSchedule(input);
  }
  async updateSchedule(
    id: string,
    fields: Partial<Omit<Schedule, 'id' | 'rule' | 'next_date' | 'completed'>>,
    resetNextDate?: boolean,
  ): Promise<void> {
    // SDK returns Promise<string> (the schedule id) — we discard it; the
    // caller already has the id.
    await api.updateSchedule(id, fields, resetNextDate);
  }
  async deleteSchedule(id: string): Promise<void> {
    await api.deleteSchedule(id);
  }

  // ---- notes (public API since @actual-app/api 26.6.0)
  async getNote(id: string): Promise<string | null> {
    const res = await api.getNote(id);
    // SDK returns `NoteEntity | null` where `NoteEntity = { id, note: string }`.
    // `.note` is always present when the entity is non-null per the SDK type.
    return res?.note ?? null;
  }
  async setNote(id: string, note: string): Promise<void> {
    await api.updateNote(id, note);
  }
  async deleteNote(id: string): Promise<void> {
    // SDK types `note` as `string` (non-null), but the underlying handler
    // accepts `null` to clear the note. The integration test validates this.
    // TODO: remove cast if SDK adds `null` to `NoteEntity['note']` in a future release.
    await api.updateNote(id, null as unknown as string);
  }

  // ---- server metadata
  async getServerVersion(): Promise<string | null> {
    const res = await api.getServerVersion();
    return 'version' in res ? res.version : null;
  }

  // ---- tags
  async getTags(): Promise<Tag[]> {
    return await api.getTags();
  }
  async createTag(tag: Omit<Tag, 'id'>): Promise<string> {
    return api.createTag(tag);
  }
  async updateTag(id: string, fields: Partial<Omit<Tag, 'id'>>): Promise<void> {
    await api.updateTag(id, fields);
  }
  async deleteTag(id: string): Promise<void> {
    await api.deleteTag(id);
  }
}

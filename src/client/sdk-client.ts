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
  async getCategories(): Promise<Category[]> {
    return (await api.getCategories()) as Category[];
  }
  async createCategory(input: Omit<Category, 'id'>): Promise<string> {
    return api.createCategory(input as Parameters<typeof api.createCategory>[0]);
  }
  async updateCategory(id: string, fields: Partial<Omit<Category, 'id'>>): Promise<void> {
    await api.updateCategory(id, fields as Parameters<typeof api.updateCategory>[1]);
  }
  async deleteCategory(id: string, transferCategoryId?: string): Promise<void> {
    await api.deleteCategory(id, transferCategoryId);
  }
  async getCategoryGroups(): Promise<CategoryGroup[]> {
    return (await api.getCategoryGroups()) as CategoryGroup[];
  }
  async createCategoryGroup(input: Omit<CategoryGroup, 'id' | 'categories'>): Promise<string> {
    return api.createCategoryGroup(input as Parameters<typeof api.createCategoryGroup>[0]);
  }
  async updateCategoryGroup(
    id: string,
    fields: Partial<Omit<CategoryGroup, 'id' | 'categories'>>,
  ): Promise<void> {
    await api.updateCategoryGroup(id, fields as Parameters<typeof api.updateCategoryGroup>[1]);
  }
  async deleteCategoryGroup(id: string, transferCategoryId?: string): Promise<void> {
    await api.deleteCategoryGroup(id, transferCategoryId);
  }

  // ---- accounts
  async getAccounts(): Promise<Account[]> {
    return (await api.getAccounts()) as Account[];
  }
  async createAccount(input: Omit<Account, 'id'>, initialBalance = 0): Promise<string> {
    return api.createAccount(input as Parameters<typeof api.createAccount>[0], initialBalance);
  }
  async updateAccount(id: string, fields: Partial<Omit<Account, 'id'>>): Promise<void> {
    await api.updateAccount(id, fields as Parameters<typeof api.updateAccount>[1]);
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
    return (await api.getTransactions(accountId, since, until)) as Transaction[];
  }
  async addTransactions(
    accountId: string,
    txs: Omit<Transaction, 'id'>[],
    opts?: { learnCategories?: boolean; runTransfers?: boolean },
  ): Promise<string> {
    return api.addTransactions(accountId, txs as Parameters<typeof api.addTransactions>[1], opts);
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
    return (await api.getPayees()) as Payee[];
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
    return (await api.getCommonPayees()) as Payee[];
  }

  // ---- rules
  async getRules(): Promise<Rule[]> {
    return (await api.getRules()) as Rule[];
  }
  async getPayeeRules(payeeId: string): Promise<Rule[]> {
    return (await api.getPayeeRules(payeeId)) as Rule[];
  }
  async createRule(rule: Omit<Rule, 'id'>): Promise<Rule> {
    return (await api.createRule(rule as Parameters<typeof api.createRule>[0])) as Rule;
  }
  async updateRule(rule: Rule): Promise<Rule> {
    return (await api.updateRule(rule as Parameters<typeof api.updateRule>[0])) as Rule;
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

  // ---- schedules — read via AQL, writes via internal.send
  async getSchedules(): Promise<Schedule[]> {
    // `select('*')` is supported at runtime by Actual's AQL even though the
    // SDK type signature only allows `any[]`.
    const res = await api.aqlQuery(api.q('schedules').select('*' as unknown as []));
    return (res as { data: Schedule[] }).data;
  }
  async createSchedule(input: {
    name: string | null;
    rule: unknown;
    active?: boolean;
    posts_transaction?: boolean;
  }): Promise<string> {
    return (await this.internalSend('schedule/create', { schedule: input })) as string;
  }
  async updateSchedule(
    id: string,
    fields: {
      name?: string | null;
      rule?: unknown;
      active?: boolean;
      posts_transaction?: boolean;
    },
  ): Promise<void> {
    await this.internalSend('schedule/update', { schedule: { id, ...fields } });
  }
  async deleteSchedule(id: string): Promise<void> {
    await this.internalSend('schedule/delete', { id });
  }

  // ---- notes (the v2 fix)
  async getNote(id: string): Promise<string | null> {
    const res = await api.aqlQuery(api.q('notes').filter({ id }).select(['id', 'note']));
    const rows = (res as { data: Array<{ id: string; note: string }> }).data;
    return rows[0]?.note ?? null;
  }
  async setNote(id: string, note: string): Promise<void> {
    await this.internalSend('notes-save', { id, note });
  }
  async deleteNote(id: string): Promise<void> {
    await this.internalSend('notes-save', { id, note: null });
  }

  // ---- tags
  async getTags(): Promise<Tag[]> {
    const res = await api.aqlQuery(api.q('tags').select('*' as unknown as []));
    return (res as { data: Tag[] }).data;
  }
  async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    return (await this.internalSend('tags-create', tag)) as Tag;
  }
  async updateTag(id: string, fields: Partial<Omit<Tag, 'id'>>): Promise<void> {
    await this.internalSend('tags-update', { id, ...fields });
  }
  async deleteTag(id: string): Promise<void> {
    await this.internalSend('tags-delete', [id]);
  }

  // Bridge to deprecated `internal.send` — the only way to persist notes/tags
  // until the SDK exposes proper top-level methods.
  private async internalSend(msg: string, payload: unknown): Promise<unknown> {
    const internal = (
      api as unknown as {
        internal: {
          send: (m: string, p: unknown) => Promise<unknown>;
        } | null;
      }
    ).internal;
    if (!internal) {
      throw new Error(
        'SdkActualClient: api.internal is not available; ensure init() has been called',
      );
    }
    return internal.send(msg, payload);
  }
}

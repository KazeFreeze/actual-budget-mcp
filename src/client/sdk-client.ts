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

// The shape of the `lib` value returned from `api.init()`. The SDK's TS types
// declare init's return as `Promise<void>` even though at runtime it returns
// the internal handler bridge ({ send, on, ... }). We only need `send`.
interface ActualLib {
  send: (msg: string, payload?: unknown) => Promise<unknown>;
}

export class SdkActualClient implements ActualClient {
  private initialized = false;
  // Captured from `api.init()` return value. Used for the deprecated-but-only
  // path to persist notes (no top-level `notes-save` SDK method exists). The
  // module-level `api.internal` export is unreliable across module-resolution
  // contexts (e.g. when the SDK ends up loaded twice through different module
  // graphs); the per-instance `lib` returned from init() is the canonical
  // reference and what the SDK's own JSDoc directs callers to use.
  private lib: ActualLib | null = null;

  constructor(private readonly opts: SdkActualClientOptions) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    // api.init's TS return type is `Promise<void>` but at runtime it returns
    // the internal bridge ({ send, on, ... }). Capture it for `internalSend`.
    const lib = await (api.init as unknown as (cfg: unknown) => Promise<ActualLib>)({
      dataDir: this.opts.dataDir,
      serverURL: this.opts.serverURL,
      password: this.opts.password,
    });
    this.lib = lib;
    await api.downloadBudget(
      this.opts.syncId,
      this.opts.encryptionPassword ? { password: this.opts.encryptionPassword } : undefined,
    );
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await api.shutdown();
    this.lib = null;
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

  // ---- schedules
  async getSchedules(): Promise<Schedule[]> {
    return (await api.getSchedules()) as Schedule[];
  }
  async createSchedule(
    input: Omit<Schedule, 'id' | 'rule' | 'next_date' | 'completed'>,
  ): Promise<string> {
    return api.createSchedule(input as Parameters<typeof api.createSchedule>[0]);
  }
  async updateSchedule(
    id: string,
    fields: Partial<Omit<Schedule, 'id' | 'rule' | 'next_date' | 'completed'>>,
    resetNextDate?: boolean,
  ): Promise<void> {
    // SDK returns Promise<string> (the schedule id) — we discard it; the
    // caller already has the id.
    await api.updateSchedule(id, fields as Parameters<typeof api.updateSchedule>[1], resetNextDate);
  }
  async deleteSchedule(id: string): Promise<void> {
    await api.deleteSchedule(id);
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
    return (await api.getTags()) as Tag[];
  }
  async createTag(tag: Omit<Tag, 'id'>): Promise<string> {
    return api.createTag(tag as Parameters<typeof api.createTag>[0]);
  }
  async updateTag(id: string, fields: Partial<Omit<Tag, 'id'>>): Promise<void> {
    await api.updateTag(id, fields as Parameters<typeof api.updateTag>[1]);
  }
  async deleteTag(id: string): Promise<void> {
    await api.deleteTag(id);
  }

  // ---- preferences
  async getCurrencyCode(): Promise<string | null> {
    // The SDK has no top-level `getPreferences` export; the synced
    // preferences live behind the internal `preferences/get` handler. We
    // route via the same `lib.send` bridge we already use for `notes-save`
    // (see `internalSend` for the full rationale — module-level
    // `api.internal` is unreliable across module-resolution contexts).
    try {
      const prefs = (await this.internalSend('preferences/get', undefined)) as
        | { defaultCurrencyCode?: unknown }
        | null
        | undefined;
      const code = prefs?.defaultCurrencyCode;
      if (typeof code === 'string' && code.length > 0) return code;
      return null;
    } catch {
      return null;
    }
  }

  // Bridge to the SDK's internal `send` — the only way to persist notes
  // until the SDK exposes a top-level `setNote`. Uses `this.lib` (captured
  // from init()'s return value) instead of the module-level `api.internal`
  // export. The module-level export is a getter over a module-private `let`
  // that can read as `null` if the SDK module was loaded through a different
  // module graph than the one calling `api.init()` — this happens in
  // production when bundlers or runtime ESM loaders end up with two copies
  // of the @actual-app/api module. The `lib` returned from init() is local
  // to this instance and immune to that hazard.
  private async internalSend(msg: string, payload: unknown): Promise<unknown> {
    if (!this.lib) {
      throw new Error('SdkActualClient: init() has not been called');
    }
    return this.lib.send(msg, payload);
  }
}

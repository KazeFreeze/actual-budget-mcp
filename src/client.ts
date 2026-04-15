import { z } from 'zod';
import pino from 'pino';
import pRetry, { AbortError } from 'p-retry';

// --- Result type ---

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

// --- Response schemas ---

const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  offbudget: z.boolean().optional(),
  closed: z.boolean().optional(),
});

const TransactionSchema = z.object({
  id: z.string(),
  is_parent: z.boolean().optional(),
  is_child: z.boolean().optional(),
  parent_id: z.string().nullable().optional(),
  account: z.string(),
  category: z.string().nullable().optional(),
  amount: z.number(),
  payee: z.string().nullable().optional(),
  payee_name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  date: z.string(),
  imported_id: z.string().nullable().optional(),
  imported_payee: z.string().nullable().optional(),
  transfer_id: z.string().nullable().optional(),
  cleared: z.boolean().optional(),
  sort_order: z.number().optional(),
  subtransactions: z.array(z.any()).optional(),
});

const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  is_income: z.boolean().optional(),
  hidden: z.boolean().optional(),
  group_id: z.string().optional(),
});

const CategoryGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_income: z.boolean().optional(),
  hidden: z.boolean().optional(),
  categories: z.array(CategorySchema).optional(),
});

const PayeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable().optional(),
  transfer_acct: z.string().nullable().optional(),
});

const BudgetMonthCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  is_income: z.boolean().optional(),
  hidden: z.boolean().optional(),
  group_id: z.string().optional(),
  budgeted: z.number().optional(),
  spent: z.number().optional(),
  balance: z.number().optional(),
  carryover: z.boolean().optional(),
});

const BudgetMonthGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_income: z.boolean().optional(),
  hidden: z.boolean().optional(),
  budgeted: z.number().optional(),
  spent: z.number().optional(),
  balance: z.number().optional(),
  categories: z.array(BudgetMonthCategorySchema).optional(),
});

const BudgetMonthSchema = z.object({
  month: z.string(),
  incomeAvailable: z.number().optional(),
  lastMonthOverspent: z.number().optional(),
  forNextMonth: z.number().optional(),
  totalBudgeted: z.number().optional(),
  toBudget: z.number().optional(),
  fromLastMonth: z.number().optional(),
  totalIncome: z.number().optional(),
  totalSpent: z.number().optional(),
  totalBalance: z.number().optional(),
  categoryGroups: z.array(BudgetMonthGroupSchema).optional(),
});

const ScheduleSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  next_date: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  posts_transaction: z.boolean().optional(),
  amount: z.any().optional(),
  amountOp: z.string().optional(),
});

const RuleConditionSchema = z.object({
  op: z.string(),
  field: z.string(),
  value: z.any(),
  type: z.string().optional(),
});

const RuleSchema = z.object({
  id: z.string(),
  stage: z.string().optional(),
  conditionsOp: z.string().optional(),
  conditions: z.array(RuleConditionSchema).optional(),
  actions: z.array(RuleConditionSchema).optional(),
});

// Exported types
export type Account = z.infer<typeof AccountSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type CategoryGroup = z.infer<typeof CategoryGroupSchema>;
export type Payee = z.infer<typeof PayeeSchema>;
export type BudgetMonth = z.infer<typeof BudgetMonthSchema>;
export type BudgetMonthCategory = z.infer<typeof BudgetMonthCategorySchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Rule = z.infer<typeof RuleSchema>;

// --- TTL Cache ---

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TtlCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  set<T>(key: string, data: T, ttlMs?: number): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// --- Client ---

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  budgetSyncId: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  retries?: number;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createClient(config: ClientConfig) {
  const {
    baseUrl,
    apiKey,
    budgetSyncId,
    timeoutMs = 10_000,
    cacheTtlMs = 60_000,
    retries = 3,
  } = config;
  const logger = pino({ name: 'http-client', level: 'info' });
  const cache = new TtlCache(cacheTtlMs);
  const budgetBase = `${baseUrl}/v1/budgets/${budgetSyncId}`;

  async function request<T>(
    method: string,
    url: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | undefined>;
      schema?: z.ZodType<T>;
      cacheKey?: string;
    },
  ): Promise<ApiResult<T>> {
    if (method === 'GET' && options?.cacheKey) {
      const cached = cache.get<T>(options.cacheKey);
      if (cached !== undefined) return { ok: true, data: cached };
    }

    try {
      const result = await pRetry(
        async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const fullUrl = new URL(url);
            if (options?.query) {
              for (const [key, value] of Object.entries(options.query)) {
                if (value !== undefined) fullUrl.searchParams.set(key, value);
              }
            }

            const startMs = Date.now();
            const response = await fetch(fullUrl.toString(), {
              method,
              headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
              body: options?.body ? JSON.stringify(options.body) : undefined,
              signal: controller.signal,
            });
            const durationMs = Date.now() - startMs;
            logger.debug({ method, url, status: response.status, durationMs }, 'HTTP request');

            if (!response.ok) {
              let errorMsg: string;
              try {
                const errorBody: unknown = await response.json();
                errorMsg = (errorBody as { error?: string }).error ?? response.statusText;
              } catch {
                errorMsg = response.statusText;
              }

              // 5xx: transient server errors — allow retry
              if (response.status >= 500) {
                throw new Error(`HTTP ${response.status}: ${errorMsg}`);
              }

              // 4xx: intentional client errors — abort retry immediately
              throw new AbortError(`HTTP ${response.status}: ${errorMsg}`);
            }

            const json: unknown = await response.json();
            const data: unknown = (json as { data?: unknown }).data ?? json;

            if (options?.schema) {
              const parsed = options.schema.safeParse(data);
              if (!parsed.success) {
                logger.warn({ url, issues: parsed.error.issues }, 'Response validation failed');
                return { ok: true as const, data: data as T };
              }
              if (method === 'GET' && options.cacheKey) cache.set(options.cacheKey, parsed.data);
              return { ok: true as const, data: parsed.data };
            }

            if (method === 'GET' && options?.cacheKey) cache.set(options.cacheKey, data);
            return { ok: true as const, data: data as T };
          } catch (err) {
            // DOM AbortError from fetch timeout — stop retrying immediately
            if (err instanceof DOMException && err.name === 'AbortError') {
              throw new AbortError(`Request timeout after ${timeoutMs}ms`);
            }
            throw err;
          } finally {
            clearTimeout(timeout);
          }
        },
        {
          retries,
          onFailedAttempt: (error) => {
            logger.warn(
              {
                attempt: error.attemptNumber,
                retriesLeft: error.retriesLeft,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
              'Retrying request',
            );
          },
        },
      );

      return result;
    } catch (err) {
      // AbortError message is the real error message (4xx or timeout)
      if (err instanceof AbortError) {
        return { ok: false, error: err.message };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    clearCache: () => cache.clear(),

    // Accounts
    getAccounts: () =>
      request<Account[]>('GET', `${budgetBase}/accounts`, {
        schema: z.array(AccountSchema),
        cacheKey: 'accounts',
      }),
    getAccountBalance: (accountId: string, cutoffDate?: string) =>
      request<number>('GET', `${budgetBase}/accounts/${accountId}/balance`, {
        query: { cutoff_date: cutoffDate },
      }),

    // Transactions
    getTransactions: (accountId: string, sinceDate: string, untilDate?: string) =>
      request<Transaction[]>('GET', `${budgetBase}/accounts/${accountId}/transactions`, {
        query: { since_date: sinceDate, until_date: untilDate },
        schema: z.array(TransactionSchema),
      }),
    createTransaction: (
      accountId: string,
      transaction: Record<string, unknown>,
      opts?: { learnCategories?: boolean; runTransfers?: boolean },
    ) =>
      request<string>('POST', `${budgetBase}/accounts/${accountId}/transactions`, {
        body: {
          transaction,
          learnCategories: opts?.learnCategories ?? false,
          runTransfers: opts?.runTransfers ?? false,
        },
      }),
    updateTransaction: (transactionId: string, fields: Record<string, unknown>) =>
      request<string>('PATCH', `${budgetBase}/transactions/${transactionId}`, {
        body: { transaction: fields },
      }),
    deleteTransaction: (transactionId: string) =>
      request<string>('DELETE', `${budgetBase}/transactions/${transactionId}`),
    importTransactions: (accountId: string, transactions: Record<string, unknown>[]) =>
      request<{ added: string[]; updated: string[] }>(
        'POST',
        `${budgetBase}/accounts/${accountId}/transactions/import`,
        { body: { transactions } },
      ),

    // Categories
    getCategories: () =>
      request<Category[]>('GET', `${budgetBase}/categories`, {
        schema: z.array(CategorySchema),
        cacheKey: 'categories',
      }),
    getCategoryGroups: () =>
      request<CategoryGroup[]>('GET', `${budgetBase}/categorygroups`, {
        schema: z.array(CategoryGroupSchema),
        cacheKey: 'categoryGroups',
      }),
    createCategory: (category: { name: string; group_id: string; is_income?: boolean }) =>
      request<string>('POST', `${budgetBase}/categories`, { body: { category } }),
    updateCategory: (categoryId: string, fields: Record<string, unknown>) =>
      request<string>('PATCH', `${budgetBase}/categories/${categoryId}`, {
        body: { category: fields },
      }),
    deleteCategory: (categoryId: string, transferCategoryId?: string) =>
      request<string>('DELETE', `${budgetBase}/categories/${categoryId}`, {
        query: { transfer_category_id: transferCategoryId },
      }),
    createCategoryGroup: (group: { name: string; is_income?: boolean }) =>
      request<string>('POST', `${budgetBase}/categorygroups`, { body: { category_group: group } }),
    updateCategoryGroup: (groupId: string, fields: Record<string, unknown>) =>
      request<string>('PATCH', `${budgetBase}/categorygroups/${groupId}`, {
        body: { category_group: fields },
      }),
    deleteCategoryGroup: (groupId: string, transferCategoryId?: string) =>
      request<string>('DELETE', `${budgetBase}/categorygroups/${groupId}`, {
        query: { transfer_category_id: transferCategoryId },
      }),

    // Payees
    getPayees: () =>
      request<Payee[]>('GET', `${budgetBase}/payees`, {
        schema: z.array(PayeeSchema),
        cacheKey: 'payees',
      }),
    createPayee: (payee: { name: string }) =>
      request<string>('POST', `${budgetBase}/payees`, { body: { payee } }),
    updatePayee: (payeeId: string, fields: Record<string, unknown>) =>
      request<string>('PATCH', `${budgetBase}/payees/${payeeId}`, { body: { payee: fields } }),
    deletePayee: (payeeId: string) => request<string>('DELETE', `${budgetBase}/payees/${payeeId}`),
    mergePayees: (targetId: string, mergeIds: string[]) =>
      request<string>('POST', `${budgetBase}/payees/merge`, { body: { targetId, mergeIds } }),

    // Budget months
    getBudgetMonths: () => request<string[]>('GET', `${budgetBase}/months`),
    getBudgetMonth: (month: string) =>
      request<BudgetMonth>('GET', `${budgetBase}/months/${month}`, { schema: BudgetMonthSchema }),
    setBudgetAmount: (month: string, categoryId: string, budgeted: number, carryover?: boolean) =>
      request<string>('PATCH', `${budgetBase}/months/${month}/categories/${categoryId}`, {
        body: { category: { budgeted, ...(carryover !== undefined && { carryover }) } },
      }),
    transferBudget: (month: string, fromCategoryId: string, toCategoryId: string, amount: number) =>
      request<string>('POST', `${budgetBase}/months/${month}/categorytransfers`, {
        body: { categorytransfer: { fromCategoryId, toCategoryId, amount } },
      }),

    // Schedules
    getSchedules: () =>
      request<Schedule[]>('GET', `${budgetBase}/schedules`, { schema: z.array(ScheduleSchema) }),
    createSchedule: (schedule: Record<string, unknown>) =>
      request<string>('POST', `${budgetBase}/schedules`, { body: { schedule } }),
    updateSchedule: (scheduleId: string, fields: Record<string, unknown>) =>
      request<string>('PATCH', `${budgetBase}/schedules/${scheduleId}`, {
        body: { schedule: fields },
      }),
    deleteSchedule: (scheduleId: string) =>
      request<string>('DELETE', `${budgetBase}/schedules/${scheduleId}`),

    // Rules
    getRules: () => request<Rule[]>('GET', `${budgetBase}/rules`, { schema: z.array(RuleSchema) }),
    createRule: (rule: Record<string, unknown>) =>
      request<Rule>('POST', `${budgetBase}/rules`, { body: { rule } }),
    updateRule: (ruleId: string, fields: Record<string, unknown>) =>
      request<Rule>('PATCH', `${budgetBase}/rules/${ruleId}`, { body: { rule: fields } }),
    deleteRule: (ruleId: string) => request<string>('DELETE', `${budgetBase}/rules/${ruleId}`),

    // Notes
    getNotes: (type: 'category' | 'account' | 'budgetmonth', id: string) =>
      request<string>('GET', `${budgetBase}/notes/${type}/${id}`),
    setNotes: (type: 'category' | 'account' | 'budgetmonth', id: string, notes: string) =>
      request<string>('PUT', `${budgetBase}/notes/${type}/${id}`, { body: { data: notes } }),
    deleteNotes: (type: 'category' | 'account' | 'budgetmonth', id: string) =>
      request<string>('DELETE', `${budgetBase}/notes/${type}/${id}`),

    // Bank sync
    runBankSync: (accountId?: string) =>
      accountId
        ? request<string>('POST', `${budgetBase}/accounts/${accountId}/banksync`)
        : request<string>('POST', `${budgetBase}/accounts/banksync`),

    // Query
    runQuery: (query: Record<string, unknown>) =>
      request<unknown>('POST', `${budgetBase}/run-query`, { body: { ActualQLquery: query } }),

    // Settings
    getBudgets: () => request<Array<{ id: string; name: string }>>('GET', `${baseUrl}/v1/budgets`),
    getApiVersion: () => request<{ version: string }>('GET', `${baseUrl}/v1/actualhttpapiversion`),

    // Health
    checkHealth: async (): Promise<boolean> => {
      const result = await request<{ version: string }>(
        'GET',
        `${baseUrl}/v1/actualhttpapiversion`,
      );
      return result.ok;
    },
  };
}

export type ActualClient = ReturnType<typeof createClient>;

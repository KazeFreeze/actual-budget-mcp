import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { registerCategoryTools } from './categories.js';
import { registerAccountTools } from './accounts.js';
import { registerTransactionTools } from './transactions.js';
import { registerPayeeTools } from './payees.js';
import { registerRuleTools } from './rules.js';
import { registerBudgetTools } from './budget.js';
import { registerScheduleTools } from './schedules.js';
import { registerNoteTools } from './notes.js';
import { registerTagTools } from './tags.js';
import { registerQueryTool } from './query.js';
import { registerUtilityTools } from './utility.js';

export function registerAllTools(server: McpServer, deps: McpServerDeps): void {
  registerCategoryTools(server, deps);
  registerAccountTools(server, deps);
  registerTransactionTools(server, deps);
  registerPayeeTools(server, deps);
  registerRuleTools(server, deps);
  registerBudgetTools(server, deps);
  registerScheduleTools(server, deps);
  registerNoteTools(server, deps);
  registerTagTools(server, deps);
  registerQueryTool(server, deps);
  registerUtilityTools(server, deps);
}

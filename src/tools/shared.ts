import { z } from 'zod';

// --- Tool types ---

export interface ToolContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolDefinition {
  schema: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}

// --- Response helpers ---

export function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function err(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

// --- Param extraction helpers ---

export function str(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === 'string' ? v : undefined;
}

export function num(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  return typeof v === 'number' ? v : undefined;
}

export function bool(params: Record<string, unknown>, key: string): boolean | undefined {
  const v = params[key];
  return typeof v === 'boolean' ? v : undefined;
}

// --- Zod to JSON Schema helper ---

export function zodInputSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

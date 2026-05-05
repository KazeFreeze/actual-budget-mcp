import { describe, it, expect } from 'vitest';
import { registerRuleTools } from '../../../src/tools/rules.js';
import { setup, call } from './_helpers.js';

describe('rule tools', () => {
  it('get-rules returns empty list when none exist', async () => {
    const { server } = setup(registerRuleTools);
    const r = await call(server, 'get-rules', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('[]');
  });

  it('get-rules returns rules from client', async () => {
    const { server, client } = setup(registerRuleTools);
    await client.createRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [],
      actions: [],
    });
    const r = await call(server, 'get-rules', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('"and"');
  });

  it('get-payee-rules returns rules for the given payee', async () => {
    const { server, client } = setup(registerRuleTools);
    client.getPayeeRules = (_payeeId) =>
      Promise.resolve([
        { id: 'r1', stage: null, conditionsOp: 'and', conditions: [], actions: [] },
      ]);
    const r = await call(server, 'get-payee-rules', { payeeId: 'p1' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('"r1"');
  });

  it('create-rule creates a new rule with all fields', async () => {
    const { server, client } = setup(registerRuleTools);
    const r = await call(server, 'create-rule', {
      stage: 'pre',
      conditionsOp: 'or',
      conditions: [{ op: 'is', field: 'payee', value: 'p1' }],
      actions: [{ op: 'set', field: 'category', value: 'c1' }],
    });
    expect(r.isError).toBeFalsy();
    const rules = await client.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.stage).toBe('pre');
    expect(rules[0]?.conditionsOp).toBe('or');
    expect(rules[0]?.conditions).toEqual([{ op: 'is', field: 'payee', value: 'p1' }]);
    expect(rules[0]?.actions).toEqual([{ op: 'set', field: 'category', value: 'c1' }]);
  });

  it('create-rule preserves a null stage', async () => {
    const { server, client } = setup(registerRuleTools);
    const r = await call(server, 'create-rule', {
      stage: null,
      conditionsOp: 'and',
      conditions: [],
      actions: [],
    });
    expect(r.isError).toBeFalsy();
    const rules = await client.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.stage).toBeNull();
  });

  it('update-rule replaces the rule', async () => {
    const { server, client } = setup(registerRuleTools);
    const created = await client.createRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [],
      actions: [],
    });
    const r = await call(server, 'update-rule', {
      id: created.id,
      stage: 'post',
      conditionsOp: 'or',
      conditions: [{ op: 'is', field: 'notes', value: 'x' }],
      actions: [{ op: 'set', field: 'cleared', value: true }],
    });
    expect(r.isError).toBeFalsy();
    const rules = await client.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.stage).toBe('post');
    expect(rules[0]?.conditionsOp).toBe('or');
    expect(rules[0]?.conditions).toEqual([{ op: 'is', field: 'notes', value: 'x' }]);
    expect(rules[0]?.actions).toEqual([{ op: 'set', field: 'cleared', value: true }]);
  });

  it('delete-rule removes the rule', async () => {
    const { server, client } = setup(registerRuleTools);
    const created = await client.createRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [],
      actions: [],
    });
    const r = await call(server, 'delete-rule', { id: created.id });
    expect(r.isError).toBeFalsy();
    const rules = await client.getRules();
    expect(rules).toHaveLength(0);
  });

  it('zod rejects create-rule with invalid conditionsOp', async () => {
    const { server } = setup(registerRuleTools);
    await expect(
      call(server, 'create-rule', {
        stage: null,
        conditionsOp: 'xor',
        conditions: [],
        actions: [],
      }),
    ).rejects.toThrow();
  });

  it('zod rejects create-rule with missing stage', async () => {
    const { server } = setup(registerRuleTools);
    await expect(
      call(server, 'create-rule', {
        conditionsOp: 'and',
        conditions: [],
        actions: [],
      }),
    ).rejects.toThrow();
  });
});

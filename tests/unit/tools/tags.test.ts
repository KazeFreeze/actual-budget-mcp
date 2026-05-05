import { describe, it, expect } from 'vitest';
import { registerTagTools } from '../../../src/tools/tags.js';
import { setup, call } from './_helpers.js';

describe('tag tools', () => {
  it('get-tags returns an empty list when no tags exist', async () => {
    const { server } = setup(registerTagTools);
    const r = await call(server, 'get-tags', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('[]');
  });

  it('get-tags returns tags from the client', async () => {
    const { server, client } = setup(registerTagTools);
    await client.createTag({ tag: 'urgent' });
    const r = await call(server, 'get-tags', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('urgent');
  });

  it('create-tag creates a tag and returns its id', async () => {
    const { server, client } = setup(registerTagTools);
    const r = await call(server, 'create-tag', { tag: 'work' });
    expect(r.isError).toBeFalsy();
    const tags = await client.getTags();
    expect(tags).toHaveLength(1);
    const id = tags[0]?.id;
    expect(id).toBeDefined();
    expect(r.content[0]?.text).toContain(id ?? '');
  });

  it('create-tag preserves an explicit color', async () => {
    const { server, client } = setup(registerTagTools);
    const r = await call(server, 'create-tag', { tag: 'food', color: '#ff0000' });
    expect(r.isError).toBeFalsy();
    const tags = await client.getTags();
    expect(tags).toHaveLength(1);
    expect(tags[0]?.color).toBe('#ff0000');
  });

  it('create-tag preserves color: null (compact only strips undefined)', async () => {
    const { server, client } = setup(registerTagTools);
    const r = await call(server, 'create-tag', { tag: 'plain', color: null });
    expect(r.isError).toBeFalsy();
    const tags = await client.getTags();
    expect(tags).toHaveLength(1);
    expect(tags[0]?.color).toBeNull();
  });

  it('update-tag updates the tag field', async () => {
    const { server, client } = setup(registerTagTools);
    const id = await client.createTag({ tag: 'old' });
    const r = await call(server, 'update-tag', { id, fields: { tag: 'renamed' } });
    expect(r.isError).toBeFalsy();
    const tags = await client.getTags();
    expect(tags[0]?.tag).toBe('renamed');
  });

  it('update-tag preserves color: null (clearing the color)', async () => {
    const { server, client } = setup(registerTagTools);
    const id = await client.createTag({ tag: 'x', color: '#abc' });
    const r = await call(server, 'update-tag', { id, fields: { color: null } });
    expect(r.isError).toBeFalsy();
    const tags = await client.getTags();
    expect(tags[0]?.color).toBeNull();
  });

  it('delete-tag removes the tag', async () => {
    const { server, client } = setup(registerTagTools);
    const id = await client.createTag({ tag: 'gone' });
    const r = await call(server, 'delete-tag', { id });
    expect(r.isError).toBeFalsy();
    expect(await client.getTags()).toHaveLength(0);
  });

  it('zod rejects empty tag on create-tag', async () => {
    const { server } = setup(registerTagTools);
    await expect(call(server, 'create-tag', { tag: '' })).rejects.toThrow();
  });
});

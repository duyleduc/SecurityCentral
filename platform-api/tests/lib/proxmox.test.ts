import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProxmoxDiscoveryClient } from '../../src/lib/cloud/proxmox.js';

describe('ProxmoxDiscoveryClient', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('discovers VMs and containers across nodes', async () => {
    const mockFetch = vi.fn()
      // /api2/json/nodes
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }] }) })
      // /api2/json/nodes/pve1/qemu
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ vmid: 100, name: 'web-01', status: 'running' }] }) })
      // /api2/json/nodes/pve1/lxc
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ vmid: 200, name: 'dns-01', status: 'running' }] }) })
      // /api2/json/nodes/pve2/qemu
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ vmid: 101, name: 'db-01', status: 'stopped' }] }) })
      // /api2/json/nodes/pve2/lxc
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ProxmoxDiscoveryClient({ baseUrl: 'https://pve:8006', tokenId: 'user@pam!sc', tokenSecret: 'xxx', verifySsl: false });
    const resources = await client.discoverInstances();

    expect(resources).toHaveLength(3);
    expect(resources[0].resourceType).toBe('vm');
    expect(resources[0].hostname).toBe('web-01');
    expect(resources[0].region).toBe('pve1');
    expect(resources[1].resourceType).toBe('container');
    expect(resources[2].status).toBe('stopped');

    // Verify auth header
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toContain('PVEAPIToken=');

    vi.unstubAllGlobals();
  });

  it('uses PVEAPIToken auth header', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ProxmoxDiscoveryClient({ baseUrl: 'https://pve:8006', tokenId: 'user@pam!mytoken', tokenSecret: 'abc123' });
    await client.discoverInstances();

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('PVEAPIToken=user@pam!mytoken=abc123');

    vi.unstubAllGlobals();
  });

  it('throws on API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => 'Unauthorized' }));

    const client = new ProxmoxDiscoveryClient({ baseUrl: 'https://pve:8006', tokenId: 'bad', tokenSecret: 'bad' });
    await expect(client.discoverInstances()).rejects.toThrow('401');

    vi.unstubAllGlobals();
  });
});

import https from 'node:https';

import type { CloudDiscoveryClient, DiscoveredResource, ProxmoxConfig } from './types.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'proxmox-discovery' });

/**
 * Proxmox VE discovery client.
 * Discovers VMs (QEMU) and containers (LXC) across all cluster nodes.
 */
export class ProxmoxDiscoveryClient implements CloudDiscoveryClient {
  readonly provider = 'proxmox';
  private readonly config: ProxmoxConfig;
  private readonly agent: https.Agent | undefined;

  constructor(config: ProxmoxConfig) {
    this.config = config;
    if (config.verifySsl === false) {
      this.agent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  async discoverInstances(): Promise<DiscoveredResource[]> {
    log.info('Discovering Proxmox VMs/containers', { baseUrl: this.config.baseUrl });

    const nodes = await this.request<{ data: PveNode[] }>('/api2/json/nodes');
    const resources: DiscoveredResource[] = [];

    for (const node of nodes.data) {
      // QEMU VMs
      const vms = await this.request<{ data: PveVm[] }>(`/api2/json/nodes/${node.node}/qemu`);
      for (const vm of vms.data) {
        resources.push({
          resourceId: `qemu/${node.node}/${vm.vmid}`,
          resourceType: 'vm',
          hostname: vm.name ?? null,
          ipAddress: null, // Proxmox doesn't expose IP in list API
          region: node.node,
          status: mapPveStatus(vm.status),
          osInfo: vm.template ? 'template' : null,
        });
      }

      // LXC containers
      const containers = await this.request<{ data: PveVm[] }>(`/api2/json/nodes/${node.node}/lxc`);
      for (const ct of containers.data) {
        resources.push({
          resourceId: `lxc/${node.node}/${ct.vmid}`,
          resourceType: 'container',
          hostname: ct.name ?? null,
          ipAddress: null,
          region: node.node,
          status: mapPveStatus(ct.status),
          osInfo: null,
        });
      }
    }

    log.info('Proxmox discovery complete', { count: resources.length, nodes: nodes.data.length });
    return resources;
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;

    const init: RequestInit = {
      method: 'GET',
      headers: {
        Authorization: `PVEAPIToken=${this.config.tokenId}=${this.config.tokenSecret}`,
      },
    };

    if (this.agent) {
      (init as any).dispatcher = this.agent;
    }

    const resp = await fetch(url, init);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Proxmox API ${path}: ${resp.status} ${text}`);
    }

    return resp.json() as Promise<T>;
  }
}

interface PveNode {
  node: string;
  status: string;
}

interface PveVm {
  vmid: number;
  name?: string;
  status: string;
  template?: boolean;
}

function mapPveStatus(status: string): string {
  switch (status) {
    case 'running': return 'running';
    case 'stopped': return 'stopped';
    default: return status;
  }
}

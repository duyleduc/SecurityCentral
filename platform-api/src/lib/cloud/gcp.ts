import type { CloudDiscoveryClient, DiscoveredResource, GcpConfig } from './types.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'gcp-discovery' });

/**
 * GCP Compute Engine instance discovery client.
 * Lists all instances across all zones in the project.
 */
export class GcpDiscoveryClient implements CloudDiscoveryClient {
  readonly provider = 'gcp';
  private readonly config: GcpConfig;

  constructor(config: GcpConfig) {
    this.config = config;
  }

  async discoverInstances(): Promise<DiscoveredResource[]> {
    log.info('Discovering GCP Compute instances', { projectId: this.config.projectId });

    try {
      const { InstancesClient } = await import('@google-cloud/compute');

      const clientOpts: Record<string, unknown> = { projectId: this.config.projectId };
      if (this.config.serviceAccountKey) {
        const key = JSON.parse(this.config.serviceAccountKey);
        clientOpts.credentials = key;
      }

      const compute = new InstancesClient(clientOpts);
      const resources: DiscoveredResource[] = [];

      // aggregatedList returns instances across all zones
      const [instances] = await compute.aggregatedList({ project: this.config.projectId });

      for (const [zone, scopedList] of Object.entries(instances)) {
        const zoneInstances = (scopedList as { instances?: any[] }).instances ?? [];
        for (const inst of zoneInstances) {
          const networkIf = inst.networkInterfaces?.[0];

          resources.push({
            resourceId: String(inst.id ?? ''),
            resourceType: 'vm',
            hostname: inst.name ?? null,
            ipAddress: networkIf?.networkIP ?? null,
            region: extractZone(zone),
            status: mapGcpStatus(inst.status),
            osInfo: inst.disks?.[0]?.licenses?.[0]?.split('/')?.pop() ?? null,
          });
        }
      }

      log.info('GCP discovery complete', { count: resources.length });
      return resources;
    } catch (err) {
      log.error('GCP discovery failed', { error: (err as Error).message });
      throw err;
    }
  }
}

function extractZone(zone: string): string {
  // "zones/us-central1-a" → "us-central1-a"
  return zone.replace('zones/', '');
}

function mapGcpStatus(status?: string): string {
  switch (status) {
    case 'RUNNING': return 'running';
    case 'TERMINATED':
    case 'STOPPED': return 'stopped';
    case 'SUSPENDED': return 'stopped';
    case 'STAGING': return 'running';
    default: return status?.toLowerCase() ?? 'unknown';
  }
}

import type { CloudDiscoveryClient, DiscoveredResource, AzureConfig } from './types.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'azure-discovery' });

/**
 * Azure VM discovery client.
 * Lists all VMs across all resource groups in the subscription.
 */
export class AzureDiscoveryClient implements CloudDiscoveryClient {
  readonly provider = 'azure';
  private readonly config: AzureConfig;

  constructor(config: AzureConfig) {
    this.config = config;
  }

  async discoverInstances(): Promise<DiscoveredResource[]> {
    log.info('Discovering Azure VMs', { tenantId: this.config.tenantId });

    try {
      const { ClientSecretCredential } = await import('@azure/identity');
      const { ComputeManagementClient } = await import('@azure/arm-compute');

      const credential = new ClientSecretCredential(
        this.config.tenantId,
        this.config.clientId,
        this.config.clientSecret,
      );

      const subscriptionId = this.config.subscriptionId ?? '';
      const compute = new ComputeManagementClient(credential, subscriptionId);
      const resources: DiscoveredResource[] = [];

      for await (const vm of compute.virtualMachines.listAll()) {
        const location = vm.location ?? '';
        const osType = vm.storageProfile?.osDisk?.osType;

        resources.push({
          resourceId: vm.vmId ?? vm.name ?? '',
          resourceType: 'vm',
          hostname: vm.osProfile?.computerName ?? vm.name ?? null,
          ipAddress: null, // Would need NetworkInterface lookup for IP
          region: location,
          status: mapAzurePowerState(vm.instanceView?.statuses),
          osInfo: osType ?? null,
        });
      }

      log.info('Azure discovery complete', { count: resources.length });
      return resources;
    } catch (err) {
      log.error('Azure discovery failed', { error: (err as Error).message });
      throw err;
    }
  }
}

function mapAzurePowerState(statuses?: Array<{ code?: string }>): string {
  const powerStatus = statuses?.find((s) => s.code?.startsWith('PowerState/'));
  const state = powerStatus?.code?.replace('PowerState/', '') ?? 'unknown';

  switch (state) {
    case 'running': return 'running';
    case 'deallocated':
    case 'stopped': return 'stopped';
    default: return state;
  }
}

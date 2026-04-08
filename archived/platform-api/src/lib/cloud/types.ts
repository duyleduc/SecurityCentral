// ---------------------------------------------------------------------------
// Shared cloud discovery interface — all providers implement this
// ---------------------------------------------------------------------------

/**
 * Normalized cloud resource from any provider.
 */
export interface DiscoveredResource {
  readonly resourceId: string;   // provider-specific instance ID
  readonly resourceType: string; // ec2 | vm | container
  readonly hostname: string | null;
  readonly ipAddress: string | null;
  readonly region: string | null;
  readonly status: string;       // running | stopped | terminated
  readonly osInfo: string | null;
}

/**
 * All cloud provider clients implement this interface.
 */
export interface CloudDiscoveryClient {
  readonly provider: string;
  discoverInstances(): Promise<DiscoveredResource[]>;
}

/**
 * Cloud provider config shapes (stored in integrations.config JSONB).
 */
export interface AwsConfig {
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly roleArn?: string;
}

export interface AzureConfig {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly subscriptionId?: string;
}

export interface GcpConfig {
  readonly projectId: string;
  readonly serviceAccountKey?: string; // JSON string
}

export interface ProxmoxConfig {
  readonly baseUrl: string;
  readonly tokenId: string;
  readonly tokenSecret: string;
  readonly verifySsl?: boolean;
}

export type CloudConfig = AwsConfig | AzureConfig | GcpConfig | ProxmoxConfig;

/**
 * Factory: create the correct cloud client for a provider.
 */
export function createCloudClient(provider: string, config: CloudConfig): CloudDiscoveryClient {
  switch (provider) {
    case 'aws': {
      const { AwsDiscoveryClient } = require('./aws.js');
      return new AwsDiscoveryClient(config as AwsConfig);
    }
    case 'azure': {
      const { AzureDiscoveryClient } = require('./azure.js');
      return new AzureDiscoveryClient(config as AzureConfig);
    }
    case 'gcp': {
      const { GcpDiscoveryClient } = require('./gcp.js');
      return new GcpDiscoveryClient(config as GcpConfig);
    }
    case 'proxmox': {
      const { ProxmoxDiscoveryClient } = require('./proxmox.js');
      return new ProxmoxDiscoveryClient(config as ProxmoxConfig);
    }
    default:
      throw new Error(`Unsupported cloud provider: ${provider}`);
  }
}

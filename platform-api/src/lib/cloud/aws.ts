import type { CloudDiscoveryClient, DiscoveredResource, AwsConfig } from './types.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'aws-discovery' });

/**
 * AWS EC2 instance discovery client.
 * Uses DescribeInstances via the AWS SDK (or CLI fallback).
 */
export class AwsDiscoveryClient implements CloudDiscoveryClient {
  readonly provider = 'aws';
  private readonly config: AwsConfig;

  constructor(config: AwsConfig) {
    this.config = config;
  }

  async discoverInstances(): Promise<DiscoveredResource[]> {
    log.info('Discovering AWS EC2 instances', { region: this.config.region });

    try {
      // Dynamic import to avoid hard dependency if SDK not installed
      const { EC2Client, DescribeInstancesCommand } = await import('@aws-sdk/client-ec2');

      const clientConfig: Record<string, unknown> = { region: this.config.region };

      if (this.config.accessKeyId && this.config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        };
      }

      if (this.config.roleArn) {
        const { STSClient, AssumeRoleCommand } = await import('@aws-sdk/client-sts');
        const sts = new STSClient({ region: this.config.region });
        const assumed = await sts.send(new AssumeRoleCommand({
          RoleArn: this.config.roleArn,
          RoleSessionName: 'securitycentral-discovery',
        }));
        clientConfig.credentials = {
          accessKeyId: assumed.Credentials!.AccessKeyId!,
          secretAccessKey: assumed.Credentials!.SecretAccessKey!,
          sessionToken: assumed.Credentials!.SessionToken!,
        };
      }

      const ec2 = new EC2Client(clientConfig);
      const resources: DiscoveredResource[] = [];
      let nextToken: string | undefined;

      do {
        const cmd = new DescribeInstancesCommand({ NextToken: nextToken, MaxResults: 100 });
        const resp = await ec2.send(cmd);

        for (const reservation of resp.Reservations ?? []) {
          for (const inst of reservation.Instances ?? []) {
            const nameTag = inst.Tags?.find((t) => t.Key === 'Name')?.Value;
            resources.push({
              resourceId: inst.InstanceId ?? '',
              resourceType: 'ec2',
              hostname: nameTag ?? inst.PrivateDnsName ?? null,
              ipAddress: inst.PrivateIpAddress ?? inst.PublicIpAddress ?? null,
              region: this.config.region,
              status: mapEc2State(inst.State?.Name),
              osInfo: inst.PlatformDetails ?? inst.Platform ?? null,
            });
          }
        }

        nextToken = resp.NextToken;
      } while (nextToken);

      log.info('AWS discovery complete', { count: resources.length });
      return resources;
    } catch (err) {
      log.error('AWS discovery failed', { error: (err as Error).message });
      throw err;
    }
  }
}

function mapEc2State(state?: string): string {
  switch (state) {
    case 'running': return 'running';
    case 'stopped': return 'stopped';
    case 'terminated': return 'terminated';
    case 'pending': return 'running';
    case 'stopping': return 'stopped';
    case 'shutting-down': return 'terminated';
    default: return state ?? 'unknown';
  }
}

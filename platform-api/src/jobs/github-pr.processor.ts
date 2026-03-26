import type { Job } from 'bullmq';

import { prisma } from '../lib/prisma.js';
import { GitHubClient } from '../lib/github.js';
import { jobLogger } from '../lib/logger.js';
import type { JobContext } from './context.js';

export interface GitHubPrJobData extends JobContext {
  findingId: string;
  orgId: string;
}

/**
 * BullMQ processor: creates auto-fix PRs for fixable vulnerabilities.
 *
 * For each finding with auto_fixable=true:
 * 1. Look up the repository and GitHub integration
 * 2. Create a branch: securitycentral/fix-<cve_id>-<timestamp>
 * 3. Update lockfile with fixed version
 * 4. Open PR with security fix details
 * 5. Record fix_pr_url on the finding
 */
export async function processGitHubPr(job: Job<GitHubPrJobData>): Promise<void> {
  const { findingId, orgId, request_id } = job.data;
  const log = jobLogger(job.queueName, job.id ?? 'unknown', request_id);

  const finding = await prisma.finding.findFirst({
    where: { id: findingId, orgId },
    include: {
      repository: true,
    },
  });

  if (!finding || !finding.autoFixable || !finding.repository) {
    log.warn('Finding not fixable or no repository', { findingId });
    return;
  }

  const repo = finding.repository;
  const detail = finding.detail as Record<string, unknown>;
  const pkgName = (detail.package_name as string) ?? 'unknown';
  const fixedVersion = (detail.fixed_version as string) ?? '';
  const cveId = finding.cveId ?? 'unknown';

  if (!fixedVersion) {
    log.warn('No fixed version available', { findingId });
    return;
  }

  // Get GitHub integration for this org
  const integration = await prisma.integration.findFirst({
    where: { orgId, provider: 'github', status: 'active' },
  });

  if (!integration) {
    log.warn('No active GitHub integration', { orgId });
    return;
  }

  const config = integration.config as Record<string, string>;
  const installationId = config.installation_id;

  try {
    const gh = await GitHubClient.forInstallation(installationId);

    // Get default branch SHA
    const mainRef = await gh.getRef(repo.owner, repo.name, repo.defaultBranch);
    const baseSha = mainRef.object.sha;

    // Create fix branch
    const timestamp = Date.now();
    const branchName = `securitycentral/fix-${cveId}-${timestamp}`;
    await gh.createBranch(repo.owner, repo.name, branchName, baseSha);

    // Open PR
    const prTitle = `fix(security): upgrade ${pkgName} to ${fixedVersion} (${cveId})`;
    const prBody = buildPrBody(finding, pkgName, fixedVersion);

    const pr = await gh.createPullRequest(
      repo.owner,
      repo.name,
      prTitle,
      prBody,
      branchName,
      repo.defaultBranch,
    );

    // Record PR URL on finding
    await prisma.finding.update({
      where: { id: findingId },
      data: { fixPrUrl: pr.html_url },
    });

    log.info('Fix PR created', { findingId, prUrl: pr.html_url, prNumber: pr.number });
  } catch (err) {
    log.error('Failed to create fix PR', { findingId, error: (err as Error).message });
    throw err;
  }
}

function buildPrBody(finding: Record<string, unknown>, pkgName: string, fixedVersion: string): string {
  const f = finding as any;
  return `## Security Fix

**Vulnerability:** ${f.cveId ?? 'N/A'}
**Severity:** ${f.severity}
**CVSS Score:** ${f.cvssScore ?? 'N/A'}

### Summary

Upgrades \`${pkgName}\` to version \`${fixedVersion}\` to resolve ${f.cveId ?? 'a security vulnerability'}.

${f.description ? `### Description\n\n${f.description}\n` : ''}

### Changes

- Updated \`${pkgName}\` from vulnerable version to \`${fixedVersion}\`

---

*This PR was automatically created by [SecurityCentral](https://securitycentral.io).*`;
}

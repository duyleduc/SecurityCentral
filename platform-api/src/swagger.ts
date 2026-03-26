import swaggerUi from 'swagger-ui-express';
import type { Express } from 'express';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'SecurityCentral Platform API',
    version: '0.0.1',
    description: 'Unified security scanning and monitoring platform — REST API for the web dashboard, CLI tools, and agent communication.',
    contact: { name: 'SecurityCentral', url: 'https://securitycentral.io' },
  },
  servers: [
    { url: '/', description: 'Current server' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],

  // =========================================================================
  // TAGS
  // =========================================================================
  tags: [
    { name: 'Health', description: 'Server health check' },
    { name: 'Auth', description: 'Authentication — register, login, refresh, API keys' },
    { name: 'Findings', description: 'Vulnerability findings CRUD, search, stats, trends' },
    { name: 'Repositories', description: 'Repository asset management and scan triggers' },
    { name: 'Servers', description: 'Infrastructure server assets' },
    { name: 'Certificates', description: 'SSL/TLS certificate monitoring' },
    { name: 'Scans', description: 'Scan lifecycle management' },
    { name: 'Dashboard', description: 'Aggregation endpoints for the web dashboard' },
    { name: 'Audit Logs', description: 'Compliance audit trail' },
    { name: 'Integrations', description: 'GitHub, GitLab, Slack integrations' },
    { name: 'Notifications', description: 'Notification preferences' },
    { name: 'Agents', description: 'Agent registration, heartbeat, findings submission (mTLS)' },
  ],

  // =========================================================================
  // SECURITY SCHEMES
  // =========================================================================
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      mTLS: { type: 'mutualTLS', description: 'Client certificate signed by SecurityCentral CA' },
    },
    schemas: {
      // --- Envelope ---
      Envelope: {
        type: 'object',
        properties: {
          data: { nullable: true },
          meta: { type: 'object', nullable: true, properties: { page: { type: 'integer' }, per_page: { type: 'integer' }, total: { type: 'integer' } } },
          errors: { type: 'array', items: { $ref: '#/components/schemas/ApiError' } },
        },
      },
      ApiError: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'RESOURCE_NOT_FOUND' },
          message: { type: 'string', example: 'Finding not found' },
          status: { type: 'integer', example: 404 },
        },
      },

      // --- Auth ---
      RegisterRequest: {
        type: 'object', required: ['orgName', 'name', 'email', 'password'],
        properties: { orgName: { type: 'string', minLength: 2 }, name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } },
      },
      LoginRequest: {
        type: 'object', required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
      },
      AuthResponse: {
        type: 'object',
        properties: { accessToken: { type: 'string' }, user: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' } } } },
      },
      CreateApiKeyRequest: {
        type: 'object', required: ['name', 'scopes'],
        properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: ['scan:write', 'findings:read', 'findings:write', 'assets:read', 'assets:write'] } }, expiresInDays: { type: 'integer', minimum: 1, maximum: 365 } },
      },
      ApiKey: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, keyPrefix: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, lastUsedAt: { type: 'string', format: 'date-time', nullable: true }, expiresAt: { type: 'string', format: 'date-time', nullable: true }, createdAt: { type: 'string', format: 'date-time' } },
      },

      // --- Finding ---
      Finding: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, source: { type: 'string', enum: ['code_scanner', 'infra_agent', 'cert_monitor'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'suppressed', 'false_positive'] },
          title: { type: 'string' }, description: { type: 'string', nullable: true },
          cveId: { type: 'string', nullable: true }, cvssScore: { type: 'number', nullable: true },
          repositoryId: { type: 'string', format: 'uuid', nullable: true },
          serverId: { type: 'string', format: 'uuid', nullable: true },
          autoFixable: { type: 'boolean' }, fixPrUrl: { type: 'string', nullable: true },
          firstSeenAt: { type: 'string', format: 'date-time' }, resolvedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      UpdateFindingRequest: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'suppressed', 'false_positive'] } } },

      // --- Repository ---
      Repository: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, provider: { type: 'string' }, owner: { type: 'string' }, name: { type: 'string' }, defaultBranch: { type: 'string' }, language: { type: 'string', nullable: true }, lastScanAt: { type: 'string', format: 'date-time', nullable: true } },
      },
      CreateRepoRequest: {
        type: 'object', required: ['provider', 'providerId', 'owner', 'name'],
        properties: { provider: { type: 'string', enum: ['github', 'gitlab', 'bitbucket'] }, providerId: { type: 'string' }, owner: { type: 'string' }, name: { type: 'string' }, defaultBranch: { type: 'string', default: 'main' }, language: { type: 'string' } },
      },

      // --- Server ---
      Server: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, hostname: { type: 'string' }, osFamily: { type: 'string' }, osVersion: { type: 'string' }, environment: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive', 'decommissioned'] }, lastHeartbeat: { type: 'string', format: 'date-time', nullable: true }, agentVersion: { type: 'string', nullable: true }, openFindingCount: { type: 'integer' } },
      },

      // --- Certificate ---
      Certificate: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, subjectCn: { type: 'string' }, sans: { type: 'array', items: { type: 'string' } }, issuerCn: { type: 'string' }, notBefore: { type: 'string', format: 'date-time' }, notAfter: { type: 'string', format: 'date-time' }, keyAlgorithm: { type: 'string' }, status: { type: 'string', enum: ['active', 'expiring', 'expired', 'revoked'] } },
      },

      // --- Scan ---
      Scan: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, scanType: { type: 'string' }, status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] }, trigger: { type: 'string' }, findingsTotal: { type: 'integer' }, findingsNew: { type: 'integer' }, findingsResolved: { type: 'integer' }, startedAt: { type: 'string', format: 'date-time', nullable: true }, completedAt: { type: 'string', format: 'date-time', nullable: true } },
      },

      // --- Dashboard ---
      DashboardSummary: {
        type: 'object',
        properties: { findings: { type: 'object', properties: { total: { type: 'integer' }, by_severity: { type: 'object', additionalProperties: { type: 'integer' } }, open: { type: 'integer' }, resolved: { type: 'integer' } } }, assets: { type: 'object', properties: { repositories: { type: 'integer' }, servers: { type: 'integer' }, certificates: { type: 'integer' } } } },
      },

      // --- Agent ---
      RegisterAgentRequest: {
        type: 'object', required: ['hostname', 'osFamily', 'osVersion', 'csr'],
        properties: { hostname: { type: 'string' }, osFamily: { type: 'string' }, osVersion: { type: 'string' }, arch: { type: 'string', enum: ['amd64', 'arm64'], default: 'amd64' }, cloudProvider: { type: 'string' }, cloudRegion: { type: 'string' }, environment: { type: 'string', enum: ['production', 'staging', 'development'] }, csr: { type: 'string', description: 'PEM-encoded PKCS#10 CSR' } },
      },
      HeartbeatRequest: {
        type: 'object', required: ['agentVersion'],
        properties: { agentVersion: { type: 'string' }, osFamily: { type: 'string' }, osVersion: { type: 'string' }, hostname: { type: 'string' }, resourceUsage: { type: 'object', properties: { cpuPercent: { type: 'number' }, memoryPercent: { type: 'number' }, diskPercent: { type: 'number' } } } },
      },
      SubmitFindingsRequest: {
        type: 'object', required: ['agent_id', 'scan_type', 'started_at', 'completed_at', 'findings'],
        properties: { agent_id: { type: 'string' }, scan_type: { type: 'string', enum: ['code_dependencies', 'code_secrets', 'infra_packages', 'infra_compliance', 'cert_discovery', 'cert_check'] }, started_at: { type: 'string', format: 'date-time' }, completed_at: { type: 'string', format: 'date-time' }, findings: { type: 'array', items: { type: 'object', required: ['type', 'severity', 'title'], properties: { type: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] }, title: { type: 'string' }, cve_id: { type: 'string' }, cvss_score: { type: 'number' }, detail: { type: 'object' }, remediation: { type: 'string' }, auto_fixable: { type: 'boolean' } } } } },
      },

      // --- Integration ---
      Integration: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, provider: { type: 'string' }, status: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } },
      },

      // --- Notification Preference ---
      NotificationPreference: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, channel: { type: 'string', enum: ['slack', 'email'] }, eventType: { type: 'string', enum: ['critical_finding', 'scan_complete', 'cert_expiry', 'agent_offline'] }, enabled: { type: 'boolean' } },
      },
    },
  },

  // =========================================================================
  // PATHS
  // =========================================================================
  paths: {
    // --- Health ---
    '/health': {
      get: { tags: ['Health'], summary: 'Health check', operationId: 'getHealth', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, timestamp: { type: 'string' } } } } } } } },
    },

    // --- Auth ---
    '/auth/register': {
      post: { tags: ['Auth'], summary: 'Register organization + first user', operationId: 'register', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } } }, responses: { 201: r('AuthResponse'), 422: errRef() } },
    },
    '/auth/login': {
      post: { tags: ['Auth'], summary: 'Login with email/password', operationId: 'login', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } }, responses: { 200: r('AuthResponse'), 401: errRef() } },
    },
    '/auth/refresh': {
      post: { tags: ['Auth'], summary: 'Refresh access token (uses HttpOnly cookie)', operationId: 'refreshToken', responses: { 200: r('AuthResponse'), 401: errRef() } },
    },
    '/auth/api-keys': {
      get: { tags: ['Auth'], summary: 'List API keys for org', operationId: 'listApiKeys', security: [{ BearerAuth: [] }], responses: { 200: rArr('ApiKey') } },
      post: { tags: ['Auth'], summary: 'Create API key (raw key shown once)', operationId: 'createApiKey', security: [{ BearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateApiKeyRequest' } } } }, responses: { 201: r('ApiKey'), 422: errRef() } },
    },
    '/auth/api-keys/{id}': {
      delete: { tags: ['Auth'], summary: 'Revoke API key', operationId: 'revokeApiKey', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 204: { description: 'Deleted' }, 404: errRef() } },
    },

    // --- Findings ---
    '/api/v1/findings': {
      get: { tags: ['Findings'], summary: 'List findings (paginated, filterable)', operationId: 'listFindings', security: [{ BearerAuth: [] }],
        parameters: [q('severity', 'Comma-separated severities'), q('status', 'Comma-separated statuses'), q('source', 'Comma-separated sources'), q('cve_id', 'Exact CVE match'), q('repository_id', 'Filter by repository', 'uuid'), q('server_id', 'Filter by server', 'uuid'), q('certificate_id', 'Filter by certificate', 'uuid'), q('q', 'Full-text search'), q('sort', 'Sort field', undefined, ['severity', 'cvss_score', 'first_seen_at', 'created_at']), q('order', 'Sort order', undefined, ['asc', 'desc']), qInt('page', 1), qInt('per_page', 50)],
        responses: { 200: rArr('Finding') } },
    },
    '/api/v1/findings/stats': {
      get: { tags: ['Findings'], summary: 'Aggregated finding counts', operationId: 'getFindingsStats', security: [{ BearerAuth: [] }], parameters: [q('source', 'Filter by source')], responses: { 200: { description: 'OK' } } },
    },
    '/api/v1/findings/trends': {
      get: { tags: ['Findings'], summary: 'New/resolved findings time series', operationId: 'getFindingsTrends', security: [{ BearerAuth: [] }], parameters: [q('interval', 'day or week', undefined, ['day', 'week']), qInt('days', 30)], responses: { 200: { description: 'OK' } } },
    },
    '/api/v1/findings/{id}': {
      get: { tags: ['Findings'], summary: 'Get finding detail', operationId: 'getFinding', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 200: r('Finding'), 404: errRef() } },
      patch: { tags: ['Findings'], summary: 'Update finding status', operationId: 'updateFinding', security: [{ BearerAuth: [] }], parameters: [pathId()], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateFindingRequest' } } } }, responses: { 200: r('Finding'), 404: errRef(), 422: errRef() } },
    },

    // --- Repositories ---
    '/api/v1/repositories': {
      get: { tags: ['Repositories'], summary: 'List repositories', operationId: 'listRepositories', security: [{ BearerAuth: [] }], parameters: [qInt('page', 1), qInt('per_page', 50), q('provider'), q('language')], responses: { 200: rArr('Repository') } },
      post: { tags: ['Repositories'], summary: 'Register repository', operationId: 'createRepository', security: [{ BearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateRepoRequest' } } } }, responses: { 201: r('Repository'), 409: errRef(), 422: errRef() } },
    },
    '/api/v1/repositories/{id}': {
      get: { tags: ['Repositories'], summary: 'Repository detail + scan summary + finding counts', operationId: 'getRepository', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 200: r('Repository'), 404: errRef() } },
      delete: { tags: ['Repositories'], summary: 'Delete repository and associated data', operationId: 'deleteRepository', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 204: { description: 'Deleted' }, 404: errRef() } },
    },
    '/api/v1/repositories/{id}/scan': {
      post: { tags: ['Repositories'], summary: 'Trigger manual scan', operationId: 'triggerScan', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 201: r('Scan'), 404: errRef(), 409: errRef() } },
    },

    // --- Servers ---
    '/api/v1/servers': {
      get: { tags: ['Servers'], summary: 'List servers', operationId: 'listServers', security: [{ BearerAuth: [] }], parameters: [qInt('page', 1), qInt('per_page', 50), q('status', 'active|inactive|decommissioned'), q('environment'), q('os_family')], responses: { 200: rArr('Server') } },
    },
    '/api/v1/servers/{id}': {
      get: { tags: ['Servers'], summary: 'Server detail with findings', operationId: 'getServer', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 200: r('Server'), 404: errRef() } },
      delete: { tags: ['Servers'], summary: 'Decommission server (soft delete)', operationId: 'decommissionServer', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 200: r('Server'), 404: errRef() } },
    },

    // --- Certificates ---
    '/api/v1/certificates': {
      get: { tags: ['Certificates'], summary: 'List certificates', operationId: 'listCertificates', security: [{ BearerAuth: [] }], parameters: [qInt('page', 1), qInt('per_page', 50), q('status', 'active|expiring|expired|revoked')], responses: { 200: rArr('Certificate') } },
    },
    '/api/v1/certificates/expiring': {
      get: { tags: ['Certificates'], summary: 'Certificates expiring within N days', operationId: 'getExpiringCertificates', security: [{ BearerAuth: [] }], parameters: [qInt('days', 30), qInt('page', 1), qInt('per_page', 50)], responses: { 200: rArr('Certificate') } },
    },
    '/api/v1/certificates/{id}': {
      get: { tags: ['Certificates'], summary: 'Certificate detail with chain info', operationId: 'getCertificate', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 200: r('Certificate'), 404: errRef() } },
    },

    // --- Scans ---
    '/api/v1/scans': {
      get: { tags: ['Scans'], summary: 'List scans', operationId: 'listScans', security: [{ BearerAuth: [] }], parameters: [qInt('page', 1), qInt('per_page', 50), q('status'), q('scan_type'), q('repository_id', undefined, 'uuid'), q('server_id', undefined, 'uuid')], responses: { 200: rArr('Scan') } },
    },
    '/api/v1/scans/{id}': {
      get: { tags: ['Scans'], summary: 'Scan detail', operationId: 'getScan', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 200: r('Scan'), 404: errRef() } },
    },
    '/api/v1/scans/{id}/cancel': {
      post: { tags: ['Scans'], summary: 'Cancel a pending/running scan', operationId: 'cancelScan', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 200: r('Scan'), 404: errRef(), 422: errRef() } },
    },

    // --- Dashboard ---
    '/api/v1/dashboard/summary': {
      get: { tags: ['Dashboard'], summary: 'Org-wide summary (findings + assets)', operationId: 'getDashboardSummary', security: [{ BearerAuth: [] }], responses: { 200: r('DashboardSummary') } },
    },
    '/api/v1/dashboard/top-risks': {
      get: { tags: ['Dashboard'], summary: 'Top 10 highest-risk open findings', operationId: 'getTopRisks', security: [{ BearerAuth: [] }], responses: { 200: rArr('Finding') } },
    },
    '/api/v1/dashboard/assets-overview': {
      get: { tags: ['Dashboard'], summary: 'Asset health overview', operationId: 'getAssetsOverview', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } },
    },

    // --- Audit Logs ---
    '/api/v1/audit-logs': {
      get: { tags: ['Audit Logs'], summary: 'List audit logs (admin only)', operationId: 'listAuditLogs', security: [{ BearerAuth: [] }], parameters: [q('entity_type'), q('entity_id'), q('actor_id'), q('from', 'ISO datetime', 'date-time'), q('to', 'ISO datetime', 'date-time'), qInt('page', 1), qInt('per_page', 50)], responses: { 200: { description: 'OK' }, 403: errRef() } },
    },

    // --- Integrations ---
    '/api/v1/integrations': {
      get: { tags: ['Integrations'], summary: 'List integrations', operationId: 'listIntegrations', security: [{ BearerAuth: [] }], responses: { 200: rArr('Integration') } },
    },
    '/api/v1/integrations/{id}': {
      delete: { tags: ['Integrations'], summary: 'Remove integration', operationId: 'deleteIntegration', security: [{ BearerAuth: [] }], parameters: [pathId()], responses: { 204: { description: 'Deleted' }, 404: errRef() } },
    },
    '/api/v1/integrations/github': {
      post: { tags: ['Integrations'], summary: 'Connect GitHub App', operationId: 'createGitHubIntegration', security: [{ BearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['installationId', 'appId'], properties: { installationId: { type: 'string' }, appId: { type: 'string' } } } } } }, responses: { 201: r('Integration'), 409: errRef() } },
    },
    '/api/v1/integrations/github/webhook': {
      post: { tags: ['Integrations'], summary: 'GitHub webhook receiver', operationId: 'githubWebhook', description: 'Receives push and installation events. Verified via X-Hub-Signature-256.', responses: { 200: { description: 'OK' }, 401: errRef() } },
    },
    '/api/v1/integrations/gitlab': {
      post: { tags: ['Integrations'], summary: 'Connect GitLab', operationId: 'createGitLabIntegration', security: [{ BearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accessToken'], properties: { accessToken: { type: 'string' } } } } } }, responses: { 201: r('Integration'), 409: errRef() } },
    },
    '/api/v1/integrations/gitlab/webhook': {
      post: { tags: ['Integrations'], summary: 'GitLab webhook receiver', operationId: 'gitlabWebhook', description: 'Receives push events. Verified via X-Gitlab-Token.', responses: { 200: { description: 'OK' }, 401: errRef() } },
    },
    '/api/v1/integrations/slack': {
      post: { tags: ['Integrations'], summary: 'Connect Slack webhook', operationId: 'createSlackIntegration', security: [{ BearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['webhookUrl'], properties: { webhookUrl: { type: 'string', format: 'url' } } } } } }, responses: { 201: r('Integration'), 409: errRef() } },
    },

    // --- Notification Preferences ---
    '/api/v1/notification-preferences': {
      get: { tags: ['Notifications'], summary: 'List notification preferences', operationId: 'listNotificationPreferences', security: [{ BearerAuth: [] }], responses: { 200: rArr('NotificationPreference') } },
      put: { tags: ['Notifications'], summary: 'Bulk update preferences', operationId: 'updateNotificationPreferences', security: [{ BearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['preferences'], properties: { preferences: { type: 'array', items: { type: 'object', properties: { channel: { type: 'string', enum: ['slack', 'email'] }, eventType: { type: 'string', enum: ['critical_finding', 'scan_complete', 'cert_expiry', 'agent_offline'] }, enabled: { type: 'boolean' } } } } } } } } }, responses: { 200: rArr('NotificationPreference') } },
    },

    // --- Agents (mTLS) ---
    '/v1/agents/register': {
      post: { tags: ['Agents'], summary: 'Register agent (API key auth)', operationId: 'registerAgent', security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterAgentRequest' } } } }, responses: { 201: { description: 'Agent registered', content: { 'application/json': { schema: { type: 'object', properties: { agentId: { type: 'string' }, signedCert: { type: 'string' }, caCert: { type: 'string' } } } } } } } },
    },
    '/v1/agents/heartbeat': {
      post: { tags: ['Agents'], summary: 'Agent heartbeat (mTLS)', operationId: 'agentHeartbeat', security: [{ mTLS: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/HeartbeatRequest' } } } }, responses: { 200: { description: 'OK with commands array' } } },
    },
    '/v1/agents/findings': {
      post: { tags: ['Agents'], summary: 'Submit scan findings batch (mTLS)', operationId: 'submitFindings', security: [{ mTLS: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmitFindingsRequest' } } } }, responses: { 201: { description: 'Ingestion result' } } },
    },
    '/v1/agents/version': {
      get: { tags: ['Agents'], summary: 'Latest agent version + download URLs', operationId: 'getAgentVersion', responses: { 200: { description: 'OK' } } },
    },
    '/v1/agents/vulndb/version': {
      get: { tags: ['Agents'], summary: 'Latest vulndb snapshot version', operationId: 'getVulndbVersion', security: [{ mTLS: [] }], responses: { 200: { description: 'OK' } } },
    },
    '/v1/agents/vulndb/download': {
      get: { tags: ['Agents'], summary: 'Download vulndb snapshot (full or delta)', operationId: 'downloadVulndb', security: [{ mTLS: [] }], parameters: [q('since', 'ISO timestamp for delta download', 'date-time')], responses: { 200: { description: 'Vulndb snapshot' } } },
    },
  },
} as const;

// =========================================================================
// Helpers for DRY path definitions
// =========================================================================

function pathId() {
  return { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
}

function q(name: string, desc?: string, format?: string, enumValues?: readonly string[]) {
  const s: Record<string, unknown> = { type: 'string' };
  if (format) s.format = format;
  if (enumValues) s.enum = enumValues;
  return { name, in: 'query', required: false, description: desc ?? '', schema: s };
}

function qInt(name: string, defaultVal: number) {
  return { name, in: 'query', required: false, schema: { type: 'integer', default: defaultVal } };
}

function r(schemaName: string) {
  return { description: 'OK', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/Envelope' }, { type: 'object', properties: { data: { $ref: `#/components/schemas/${schemaName}` } } }] } } } };
}

function rArr(schemaName: string) {
  return { description: 'OK', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/Envelope' }, { type: 'object', properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${schemaName}` } } } }] } } } };
}

function errRef() {
  return { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } };
}

// =========================================================================
// Mount Swagger UI
// =========================================================================

export function setupSwagger(app: Express): void {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec as any, {
    customSiteTitle: 'SecurityCentral API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
  }));

  // Raw JSON spec
  app.get('/docs/openapi.json', (_req, res) => {
    res.json(spec);
  });
}

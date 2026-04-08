import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Mock Prisma — vi.mock is hoisted, so use vi.fn() directly
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    organization: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    apiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Import after mocks
import bcrypt from 'bcrypt';
import { prisma } from '../../../src/lib/prisma.js';
import * as authService from '../../../src/modules/auth/auth.service.js';
import { verifyAccessToken } from '../../../src/lib/jwt.js';

const mockPrisma = vi.mocked(prisma);

describe('Auth Service', () => {
  const makeUser = async () => ({
    id: 'user-uuid',
    orgId: 'org-uuid',
    email: 'test@example.com',
    name: 'Test User',
    role: 'owner',
    passwordHash: await bcrypt.hash('Password123', 10),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Register ---

  describe('register', () => {
    it('creates org + user and returns token pair', async () => {
      const user = await makeUser();
      mockPrisma.organization.create.mockResolvedValue({
        id: 'org-uuid',
        name: 'TestOrg',
        slug: 'testorg-abc123',
        plan: 'starter',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        users: [user],
      } as any);

      const result = await authService.register({
        orgName: 'TestOrg',
        name: 'Test User',
        email: 'test@example.com',
        password: 'Password123',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.user.role).toBe('owner');
      expect(result.org.name).toBe('TestOrg');
      expect(result.tokens.accessToken).toBeDefined();

      const decoded = verifyAccessToken(result.tokens.accessToken);
      expect(decoded.sub).toBe('user-uuid');
      expect(decoded.org).toBe('org-uuid');
    });
  });

  // --- Login ---

  describe('login', () => {
    it('returns tokens for valid credentials', async () => {
      const user = await makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user as any);

      const result = await authService.login({
        email: 'test@example.com',
        password: 'Password123',
      });

      expect(result.tokens.accessToken).toBeDefined();
      expect(result.user.id).toBe('user-uuid');
    });

    it('throws AUTH_INVALID_CREDENTIALS for wrong email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'wrong@example.com', password: 'Password123' }),
      ).rejects.toThrow('Invalid email or password');
    });

    it('throws AUTH_INVALID_CREDENTIALS for wrong password', async () => {
      const user = await makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user as any);

      await expect(
        authService.login({ email: 'test@example.com', password: 'WrongPassword' }),
      ).rejects.toThrow('Invalid email or password');
    });
  });

  // --- Refresh ---

  describe('refresh', () => {
    it('returns new token pair for valid refresh token', async () => {
      const user = await makeUser();
      mockPrisma.organization.create.mockResolvedValue({
        id: 'org-uuid',
        name: 'TestOrg',
        slug: 'testorg-abc123',
        plan: 'starter',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        users: [user],
      } as any);

      const reg = await authService.register({
        orgName: 'TestOrg',
        name: 'Test User',
        email: 'test@example.com',
        password: 'Password123',
      });

      mockPrisma.user.findUnique.mockResolvedValue(user as any);

      const newTokens = await authService.refresh(reg.tokens.refreshToken);
      expect(newTokens.accessToken).toBeDefined();
      expect(newTokens.refreshToken).toBeDefined();
    });

    it('throws for invalid refresh token', async () => {
      await expect(authService.refresh('invalid-token')).rejects.toThrow();
    });
  });

  // --- API Keys ---

  describe('createApiKey', () => {
    it('creates an API key with sc_live_ prefix', async () => {
      mockPrisma.apiKey.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'key-uuid', ...data }),
      );

      const result = await authService.createApiKey({
        orgId: 'org-uuid',
        createdBy: 'user-uuid',
        name: 'CI Key',
        scopes: ['scan:write', 'findings:read'],
      });

      expect(result.rawKey).toMatch(/^sc_live_/);
      expect(result.keyPrefix).toMatch(/^sc_live_/);
      expect(result.name).toBe('CI Key');
    });
  });

  describe('authenticateApiKey', () => {
    it('authenticates a valid API key', async () => {
      const rawKey = 'sc_live_' + crypto.randomBytes(32).toString('base64url');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 16);

      mockPrisma.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-uuid',
          orgId: 'org-uuid',
          createdBy: 'user-uuid',
          keyHash,
          keyPrefix,
          scopes: ['scan:write'],
          expiresAt: null,
        },
      ] as any);
      mockPrisma.apiKey.update.mockResolvedValue({} as any);

      const result = await authService.authenticateApiKey(rawKey);
      expect(result.orgId).toBe('org-uuid');
    });

    it('throws for invalid API key', async () => {
      mockPrisma.apiKey.findMany.mockResolvedValue([]);
      await expect(authService.authenticateApiKey('sc_live_invalid')).rejects.toThrow('Invalid API key');
    });

    it('throws for expired API key', async () => {
      const rawKey = 'sc_live_' + crypto.randomBytes(32).toString('base64url');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 16);

      mockPrisma.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-uuid',
          orgId: 'org-uuid',
          createdBy: 'user-uuid',
          keyHash,
          keyPrefix,
          scopes: ['scan:write'],
          expiresAt: new Date('2020-01-01'),
        },
      ] as any);

      await expect(authService.authenticateApiKey(rawKey)).rejects.toThrow('expired');
    });
  });

  describe('revokeApiKey', () => {
    it('deletes the API key', async () => {
      mockPrisma.apiKey.findFirst.mockResolvedValue({ id: 'key-uuid', orgId: 'org-uuid' } as any);
      mockPrisma.apiKey.delete.mockResolvedValue({} as any);

      await expect(authService.revokeApiKey('org-uuid', 'key-uuid')).resolves.not.toThrow();
    });

    it('throws RESOURCE_NOT_FOUND for non-existent key', async () => {
      mockPrisma.apiKey.findFirst.mockResolvedValue(null);
      await expect(authService.revokeApiKey('org-uuid', 'bad-id')).rejects.toThrow('API key not found');
    });
  });
});

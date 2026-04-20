import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';

export async function getById(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      _count: {
        select: {
          users: true,
          projects: true,
          repositories: true,
          findings: true,
        },
      },
    },
  });
  if (!org) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Organization not found');
  }
  return org;
}

export async function update(orgId: string, data: { name?: string }) {
  const existing = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Organization not found');
  }

  return prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(data.name ? { name: data.name } : {}),
    },
  });
}

export async function listMembers(orgId: string) {
  return prisma.user.findMany({
    where: { orgId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function updateMemberRole(orgId: string, userId: string, role: 'member' | 'admin') {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) {
    throw new AppError('RESOURCE_NOT_FOUND', 'User not found');
  }
  // Owners keep their role (treated as admin) — promotion via this endpoint is not allowed.
  if (user.role === 'owner') {
    throw new AppError('VALIDATION_ERROR', 'The organization owner cannot be demoted');
  }
  // Guardrail: org must always retain at least one admin-tier user.
  if (role !== 'admin') {
    const adminCount = await prisma.user.count({
      where: { orgId, role: { in: ['owner', 'admin'] } },
    });
    if (adminCount <= 1 && (user.role === 'admin' || user.role === 'owner')) {
      throw new AppError('VALIDATION_ERROR', 'Cannot demote the last admin');
    }
  }
  return prisma.user.update({
    where: { id: userId },
    data: { role },
    select: { id: true, name: true, email: true, role: true },
  });
}

export async function removeMember(orgId: string, userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) {
    throw new AppError('RESOURCE_NOT_FOUND', 'User not found');
  }
  if (user.role === 'owner') {
    throw new AppError('VALIDATION_ERROR', 'Cannot remove the owner');
  }
  await prisma.user.delete({ where: { id: userId } });
}

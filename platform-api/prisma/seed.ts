import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12);

  // Create demo org + owner
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      name: 'Demo Organization',
      slug: 'demo-org',
      users: {
        create: {
          email: 'admin@demo.com',
          name: 'Admin User',
          role: 'owner',
          passwordHash,
        },
      },
    },
    include: { users: true },
  });

  // Create a sample project
  const project = await prisma.project.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      orgId: org.id,
      name: 'Production',
      description: 'Production infrastructure and domains',
    },
  });

  // Create a sample monitored endpoint
  await prisma.monitoredEndpoint.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      orgId: org.id,
      projectId: project.id,
      host: 'google.com',
      port: 443,
      protocol: 'https',
      checkInterval: '1h',
      nextCheckAt: new Date(),
    },
  });

  console.log('Seed data created:');
  console.log(`  Org: ${org.name} (${org.id})`);
  console.log(`  User: ${org.users[0].email}`);
  console.log(`  Project: ${project.name}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });

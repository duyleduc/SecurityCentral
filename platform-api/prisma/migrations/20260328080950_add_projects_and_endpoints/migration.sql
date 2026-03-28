-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "onboarding_completed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "project_id" UUID;

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "project_id" UUID;

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "hostname" TEXT,
    "ip_address" TEXT,
    "region" TEXT,
    "status" TEXT,
    "os_info" TEXT,
    "server_id" UUID,
    "last_synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cloud_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_endpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 443,
    "label" TEXT,
    "check_interval" TEXT NOT NULL DEFAULT '1h',
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_checked_at" TIMESTAMPTZ,
    "last_status" TEXT,
    "last_response_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project_id" UUID,

    CONSTRAINT "monitored_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_org_time" ON "audit_logs"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_cloud_resources_server" ON "cloud_resources"("server_id");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_resources_org_id_provider_resource_id_key" ON "cloud_resources"("org_id", "provider", "resource_id");

-- CreateIndex
CREATE INDEX "idx_monitored_endpoints_org_status" ON "monitored_endpoints"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "monitored_endpoints_org_id_host_port_key" ON "monitored_endpoints"("org_id", "host", "port");

-- CreateIndex
CREATE UNIQUE INDEX "projects_org_id_name_key" ON "projects"("org_id", "name");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "servers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloud_resources" ADD CONSTRAINT "cloud_resources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloud_resources" ADD CONSTRAINT "cloud_resources_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloud_resources" ADD CONSTRAINT "cloud_resources_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_endpoints" ADD CONSTRAINT "monitored_endpoints_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_endpoints" ADD CONSTRAINT "monitored_endpoints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

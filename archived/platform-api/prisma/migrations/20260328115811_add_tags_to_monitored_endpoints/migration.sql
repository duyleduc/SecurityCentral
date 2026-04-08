-- AlterTable
ALTER TABLE "monitored_endpoints" ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '{}';

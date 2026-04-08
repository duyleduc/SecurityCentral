/*
  Warnings:

  - You are about to drop the column `environment` on the `servers` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "servers" DROP COLUMN "environment",
ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '{}';

-- DropForeignKey
ALTER TABLE "findings" DROP CONSTRAINT "findings_scan_id_fkey";

-- AlterTable
ALTER TABLE "findings" ALTER COLUMN "scan_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

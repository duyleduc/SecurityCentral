-- AlterTable
ALTER TABLE `monitored_endpoints` ADD COLUMN `last_ssl_check_at` DATETIME(3) NULL,
    ADD COLUMN `uptime_interval` INTEGER NOT NULL DEFAULT 15,
    ADD COLUMN `uptime_timeout` INTEGER NOT NULL DEFAULT 30;

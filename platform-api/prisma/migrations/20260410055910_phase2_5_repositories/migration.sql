-- AlterTable
ALTER TABLE `findings` ADD COLUMN `repository_id` VARCHAR(36) NULL;

-- AlterTable
ALTER TABLE `integrations` ADD COLUMN `base_url` VARCHAR(500) NULL,
    ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    ADD COLUMN `verify_ssl` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `webhook_secret` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `scans` ADD COLUMN `branch` VARCHAR(255) NULL,
    ADD COLUMN `repository_id` VARCHAR(36) NULL;

-- CreateTable
CREATE TABLE `repositories` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `project_id` VARCHAR(36) NULL,
    `integration_id` VARCHAR(36) NULL,
    `provider` VARCHAR(20) NOT NULL,
    `provider_id` VARCHAR(100) NOT NULL,
    `owner` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `default_branch` VARCHAR(100) NOT NULL DEFAULT 'main',
    `language` VARCHAR(50) NULL,
    `clone_url` VARCHAR(500) NULL,
    `last_scan_at` DATETIME(3) NULL,
    `settings` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `repositories_org_id_idx`(`org_id`),
    INDEX `repositories_project_id_idx`(`project_id`),
    INDEX `repositories_integration_id_idx`(`integration_id`),
    UNIQUE INDEX `repositories_org_id_provider_provider_id_key`(`org_id`, `provider`, `provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `findings_repository_id_idx` ON `findings`(`repository_id`);

-- CreateIndex
CREATE INDEX `scans_repository_id_idx` ON `scans`(`repository_id`);

-- AddForeignKey
ALTER TABLE `repositories` ADD CONSTRAINT `repositories_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repositories` ADD CONSTRAINT `repositories_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repositories` ADD CONSTRAINT `repositories_integration_id_fkey` FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scans` ADD CONSTRAINT `scans_repository_id_fkey` FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `findings` ADD CONSTRAINT `findings_repository_id_fkey` FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `organizations` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `plan` VARCHAR(20) NOT NULL DEFAULT 'free',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `organizations_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'member',
    `password_hash` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_org_id_idx`(`org_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `created_by` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `key_hash` VARCHAR(64) NOT NULL,
    `key_prefix` VARCHAR(30) NOT NULL,
    `scopes` JSON NOT NULL,
    `last_used_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_keys_org_id_idx`(`org_id`),
    INDEX `api_keys_key_prefix_idx`(`key_prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `install_tokens` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `project_id` VARCHAR(36) NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `label` VARCHAR(100) NOT NULL DEFAULT '',
    `used_at` DATETIME(3) NULL,
    `used_by` VARCHAR(36) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `install_tokens_org_id_idx`(`org_id`),
    INDEX `install_tokens_token_hash_idx`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(1000) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `projects_org_id_idx`(`org_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `servers` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `project_id` VARCHAR(36) NULL,
    `hostname` VARCHAR(255) NOT NULL,
    `agent_id` VARCHAR(36) NULL,
    `agent_version` VARCHAR(20) NULL,
    `os_family` VARCHAR(50) NULL,
    `os_version` VARCHAR(50) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'offline',
    `last_heartbeat` DATETIME(3) NULL,
    `api_key_hash` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `servers_agent_id_key`(`agent_id`),
    INDEX `servers_org_id_idx`(`org_id`),
    INDEX `servers_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `server_metric_snapshots` (
    `id` VARCHAR(36) NOT NULL,
    `server_id` VARCHAR(36) NOT NULL,
    `cpu` DOUBLE NOT NULL,
    `memory` DOUBLE NOT NULL,
    `disk` DOUBLE NOT NULL,
    `urgent` BOOLEAN NOT NULL DEFAULT false,
    `alerts` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `server_metric_snapshots_server_id_created_at_idx`(`server_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monitored_endpoints` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `project_id` VARCHAR(36) NULL,
    `host` VARCHAR(255) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 443,
    `protocol` VARCHAR(10) NOT NULL DEFAULT 'https',
    `check_interval` VARCHAR(10) NOT NULL DEFAULT '1h',
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `last_check_at` DATETIME(3) NULL,
    `next_check_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `monitored_endpoints_org_id_idx`(`org_id`),
    INDEX `monitored_endpoints_project_id_idx`(`project_id`),
    INDEX `monitored_endpoints_next_check_at_idx`(`next_check_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `endpoint_heartbeats` (
    `id` VARCHAR(36) NOT NULL,
    `endpoint_id` VARCHAR(36) NOT NULL,
    `status_code` INTEGER NULL,
    `response_ms` INTEGER NULL,
    `is_up` BOOLEAN NOT NULL,
    `ssl_valid` BOOLEAN NULL,
    `ssl_expiry` DATETIME(3) NULL,
    `ssl_issuer` VARCHAR(255) NULL,
    `ssl_days_left` INTEGER NULL,
    `tls_version` VARCHAR(20) NULL,
    `dns_spf` VARCHAR(20) NULL,
    `dns_dkim` VARCHAR(20) NULL,
    `dns_dmarc` VARCHAR(20) NULL,
    `details` JSON NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `endpoint_heartbeats_endpoint_id_created_at_idx`(`endpoint_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scans` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `trigger` VARCHAR(20) NOT NULL DEFAULT 'manual',
    `duration` INTEGER NULL,
    `findings_total` INTEGER NOT NULL DEFAULT 0,
    `meta` JSON NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `scans_org_id_idx`(`org_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `findings` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `scan_id` VARCHAR(36) NULL,
    `server_id` VARCHAR(36) NULL,
    `endpoint_id` VARCHAR(36) NULL,
    `source` VARCHAR(30) NOT NULL,
    `severity` VARCHAR(10) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `title` VARCHAR(500) NOT NULL,
    `description` TEXT NULL,
    `cve_id` VARCHAR(30) NULL,
    `cvss_score` DOUBLE NULL,
    `detail` JSON NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `findings_org_id_idx`(`org_id`),
    INDEX `findings_org_id_severity_idx`(`org_id`, `severity`),
    INDEX `findings_org_id_status_idx`(`org_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integrations` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `config` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `integrations_org_id_provider_key`(`org_id`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `actor_id` VARCHAR(36) NULL,
    `action` VARCHAR(50) NOT NULL,
    `entity_type` VARCHAR(50) NOT NULL,
    `entity_id` VARCHAR(36) NULL,
    `old_values` JSON NULL,
    `new_values` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_org_id_created_at_idx`(`org_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` VARCHAR(36) NOT NULL,
    `org_id` VARCHAR(36) NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `event_type` VARCHAR(50) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `config` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_preferences_org_id_channel_event_type_key`(`org_id`, `channel`, `event_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `install_tokens` ADD CONSTRAINT `install_tokens_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `install_tokens` ADD CONSTRAINT `install_tokens_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `servers` ADD CONSTRAINT `servers_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `server_metric_snapshots` ADD CONSTRAINT `server_metric_snapshots_server_id_fkey` FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `monitored_endpoints` ADD CONSTRAINT `monitored_endpoints_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `endpoint_heartbeats` ADD CONSTRAINT `endpoint_heartbeats_endpoint_id_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `monitored_endpoints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scans` ADD CONSTRAINT `scans_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `findings` ADD CONSTRAINT `findings_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `findings` ADD CONSTRAINT `findings_scan_id_fkey` FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `findings` ADD CONSTRAINT `findings_server_id_fkey` FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integrations` ADD CONSTRAINT `integrations_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

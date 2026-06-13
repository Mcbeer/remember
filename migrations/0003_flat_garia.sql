CREATE TABLE `inbox_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`secret` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_addresses_list_id_unique` ON `inbox_addresses` (`list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_addresses_secret_unique` ON `inbox_addresses` (`secret`);--> statement-breakpoint
CREATE INDEX `idx_inbox_addresses_secret` ON `inbox_addresses` (`secret`);
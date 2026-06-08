CREATE TABLE `families` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`secret` text NOT NULL,
	`created_by` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_family_id_unique` ON `invites` (`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invites_secret_unique` ON `invites` (`secret`);--> statement-breakpoint
CREATE INDEX `idx_invites_secret` ON `invites` (`secret`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`due_at` text,
	`due_timezone` text,
	`origin` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_items_completed_bool" CHECK("items"."completed" IN (0, 1)),
	CONSTRAINT "ck_items_due_pair" CHECK(("items"."due_at" IS NULL) = ("items"."due_timezone" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_items_list` ON `items` (`list_id`);--> statement-breakpoint
CREATE INDEX `idx_items_due` ON `items` (`due_at`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text,
	`owner_family_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_lists_exactly_one_owner" CHECK(("lists"."owner_user_id" IS NOT NULL AND "lists"."owner_family_id" IS NULL) OR ("lists"."owner_user_id" IS NULL AND "lists"."owner_family_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_lists_owner_user` ON `lists` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_lists_owner_family` ON `lists` (`owner_family_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`family_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_membership_user_family` ON `memberships` (`user_id`,`family_id`);--> statement-breakpoint
CREATE INDEX `idx_memberships_user` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_memberships_family` ON `memberships` (`family_id`);--> statement-breakpoint
CREATE TABLE `oauth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_oauth_provider_subject` ON `oauth_identities` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_identities_user` ON `oauth_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`occurrence_at` text NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`override_title` text,
	`override_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_occurrences_completed_bool" CHECK("occurrences"."completed" IN (0, 1)),
	CONSTRAINT "ck_occurrences_skipped_bool" CHECK("occurrences"."skipped" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_occurrence_schedule_at` ON `occurrences` (`schedule_id`,`occurrence_at`);--> statement-breakpoint
CREATE INDEX `idx_occurrences_schedule` ON `occurrences` (`schedule_id`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`title` text NOT NULL,
	`rrule` text NOT NULL,
	`dtstart` text NOT NULL,
	`timezone` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_schedules_list` ON `schedules` (`list_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
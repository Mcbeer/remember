CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `idx_push_subscriptions_user` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text,
	`schedule_id` text,
	`offset_minutes` integer NOT NULL,
	`last_sent_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_reminders_exactly_one_anchor" CHECK(("reminders"."item_id" IS NOT NULL AND "reminders"."schedule_id" IS NULL) OR ("reminders"."item_id" IS NULL AND "reminders"."schedule_id" IS NOT NULL)),
	CONSTRAINT "ck_reminders_offset_nonneg" CHECK("reminders"."offset_minutes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_reminders_item` ON `reminders` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_reminders_schedule` ON `reminders` (`schedule_id`);
CREATE TABLE `investigation_state` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`selected_claim_id` text NOT NULL,
	`debt_status` text DEFAULT 'proposed' NOT NULL,
	`reviewed` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);

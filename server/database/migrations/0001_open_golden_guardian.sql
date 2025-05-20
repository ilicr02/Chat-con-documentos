PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_document_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text,
	`text` text,
	`session_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_document_chunks`("id", "document_id", "text", "session_id") SELECT "id", "document_id", "text", "session_id" FROM `document_chunks`;--> statement-breakpoint
DROP TABLE `document_chunks`;--> statement-breakpoint
ALTER TABLE `__new_document_chunks` RENAME TO `document_chunks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
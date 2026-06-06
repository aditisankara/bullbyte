CREATE TABLE "executives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_name" text NOT NULL,
	"company_id" uuid NOT NULL,
	"role" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executives" ADD CONSTRAINT "executives_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_executives_company_role" ON "executives" USING btree ("company_id","role");--> statement-breakpoint
CREATE INDEX "idx_executives_person_name" ON "executives" USING btree ("person_name");
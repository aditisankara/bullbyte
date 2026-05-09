CREATE TYPE IF NOT EXISTS "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE IF NOT EXISTS "public"."verdict_type" AS ENUM('DELIVERED', 'MISSED', 'INSUFFICIENT_DATA', 'PENDING', 'REVISED');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"last_analysed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_ticker_unique" UNIQUE("ticker")
);
--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"quarter" text NOT NULL,
	"raw_quote" text NOT NULL,
	"metric" text NOT NULL,
	"target_value" text NOT NULL,
	"extraction_confidence" numeric(4, 3) NOT NULL,
	"speaker" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_confidence_range" CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1)
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"verdict_type" "verdict_type" NOT NULL,
	"delta" text,
	"confidence_score" numeric(4, 3),
	"is_correction" boolean DEFAULT false NOT NULL,
	"corrects_verdict_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confidence_score_range" CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
	CONSTRAINT "no_self_correction" CHECK (corrects_verdict_id IS NULL OR corrects_verdict_id != id)
);
--> statement-breakpoint
CREATE TABLE "reasoning_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verdict_id" uuid NOT NULL,
	"step_index" integer,
	"tool_call" jsonb,
	"result_summary" text,
	"edgar_filing_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_corrects_verdict_id_verdicts_id_fk" FOREIGN KEY ("corrects_verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reasoning_traces" ADD CONSTRAINT "reasoning_traces_verdict_id_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_job_id_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_claims_company_id" ON "claims" USING btree ("company_id");

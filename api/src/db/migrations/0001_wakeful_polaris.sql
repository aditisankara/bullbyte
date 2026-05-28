CREATE TABLE "financial_actuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"quarter" text NOT NULL,
	"filing_type" text NOT NULL,
	"status" text NOT NULL,
	"filing_url" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_actuals_ticker_quarter_unique" UNIQUE("ticker","quarter")
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"quarter" text NOT NULL,
	"filing_date" text NOT NULL,
	"raw_text" text NOT NULL,
	"filing_url" text NOT NULL,
	"parse_status" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcripts_ticker_quarter_unique" UNIQUE("ticker","quarter")
);
--> statement-breakpoint
CREATE INDEX "idx_financial_actuals_ticker" ON "financial_actuals" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "idx_transcripts_ticker" ON "transcripts" USING btree ("ticker");
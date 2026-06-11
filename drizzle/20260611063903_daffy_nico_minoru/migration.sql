CREATE TABLE "model_artifact" (
	"model_version" text PRIMARY KEY,
	"format" text NOT NULL,
	"artifact" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_artifact" ADD CONSTRAINT "model_artifact_model_version_model_run_model_version_fkey" FOREIGN KEY ("model_version") REFERENCES "model_run"("model_version");
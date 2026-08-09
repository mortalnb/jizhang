ALTER TABLE "usage_events" ADD COLUMN "audio_seconds" INTEGER;

CREATE TABLE "ledger_snapshots" (
    "user_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "checksum" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "device_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ledger_snapshots_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "ledger_snapshots" ADD CONSTRAINT "ledger_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "user_entitlements"
SET "allowed_models" = array_append(COALESCE("allowed_models", ARRAY[]::TEXT[]), 'mimo-v2.5-asr')
WHERE "allowed_models" IS NULL OR NOT ('mimo-v2.5-asr' = ANY("allowed_models"));

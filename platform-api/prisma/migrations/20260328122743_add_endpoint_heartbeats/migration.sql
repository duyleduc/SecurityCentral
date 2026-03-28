-- CreateTable
CREATE TABLE "endpoint_heartbeats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "endpoint_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "status_code" INTEGER,
    "response_ms" INTEGER NOT NULL,
    "message" TEXT,
    "cert_days_left" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "endpoint_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_heartbeats_endpoint_time" ON "endpoint_heartbeats"("endpoint_id", "created_at");

-- AddForeignKey
ALTER TABLE "endpoint_heartbeats" ADD CONSTRAINT "endpoint_heartbeats_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "monitored_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StripeSnapshot" (
  "id" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "data" JSONB NOT NULL,
  CONSTRAINT "StripeSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StripeSnapshot_scopeId_date_key" ON "StripeSnapshot"("scopeId", "date");

CREATE TABLE "SocialSnapshot" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "data" JSONB NOT NULL,
  CONSTRAINT "SocialSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SocialSnapshot_provider_accountId_date_key" ON "SocialSnapshot"("provider", "accountId", "date");

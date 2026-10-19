CREATE TABLE "XAdsSnapshot" ("id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "date" DATE NOT NULL, "capturedAt" TIMESTAMP(3) NOT NULL, "data" JSONB NOT NULL, CONSTRAINT "XAdsSnapshot_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "XAdsSnapshot_accountId_date_key" ON "XAdsSnapshot"("accountId", "date");

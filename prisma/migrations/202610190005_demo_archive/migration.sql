CREATE TABLE "DemoArchive" ("id" TEXT NOT NULL, "batchId" TEXT NOT NULL, "recordType" TEXT NOT NULL, "recordId" TEXT NOT NULL, "data" JSONB NOT NULL, "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DemoArchive_pkey" PRIMARY KEY ("id"));
CREATE INDEX "DemoArchive_batchId_idx" ON "DemoArchive"("batchId");

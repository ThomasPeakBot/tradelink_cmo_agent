CREATE TABLE "ExperimentIdea" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "focus" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "feedback" TEXT NOT NULL DEFAULT '',
  "experimentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ExperimentIdea_experimentId_key" ON "ExperimentIdea"("experimentId");

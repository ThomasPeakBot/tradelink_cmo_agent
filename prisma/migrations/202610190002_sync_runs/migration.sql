CREATE TABLE "SyncRun" (
 "id" TEXT NOT NULL PRIMARY KEY, "actor" TEXT NOT NULL, "trigger" TEXT NOT NULL,
 "scheduledDay" DATE, "status" TEXT NOT NULL DEFAULT 'RUNNING',
 "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), "results" JSONB NOT NULL
);
CREATE UNIQUE INDEX "SyncRun_scheduledDay_key" ON "SyncRun"("scheduledDay");

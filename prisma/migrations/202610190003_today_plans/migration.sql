CREATE TABLE "DailyPlan" (
 "id" TEXT NOT NULL PRIMARY KEY, "date" DATE NOT NULL, "budgetMinutes" INTEGER NOT NULL,
 "summary" TEXT NOT NULL, "warnings" JSONB NOT NULL, "provider" TEXT NOT NULL,
 "isDemo" BOOLEAN NOT NULL DEFAULT false, "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "dataAsOf" TIMESTAMP(3) NOT NULL,
 "checkIn" TEXT NOT NULL DEFAULT '', "learning" TEXT NOT NULL DEFAULT '', "blockers" TEXT NOT NULL DEFAULT '', "checkedInAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "DailyPlan_date_key" ON "DailyPlan"("date");
CREATE TABLE "TodayTask" (
 "id" TEXT NOT NULL PRIMARY KEY, "planId" TEXT NOT NULL, "position" INTEGER NOT NULL,
 "title" TEXT NOT NULL, "minutes" INTEGER NOT NULL, "deliverable" TEXT NOT NULL,
 "successMetric" TEXT NOT NULL, "rationale" TEXT NOT NULL, "evidence" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PROPOSED', "outcome" TEXT NOT NULL DEFAULT '',
 "actualMinutes" INTEGER, "completedAt" TIMESTAMP(3),
 CONSTRAINT "TodayTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DailyPlan"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "TodayTask_planId_position_key" ON "TodayTask"("planId","position");

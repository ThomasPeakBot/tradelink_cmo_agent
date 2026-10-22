ALTER TABLE "TodayTask" ADD COLUMN "prerequisiteTaskIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "TodayTask" ADD COLUMN "deferralReason" TEXT NOT NULL DEFAULT '';
UPDATE "TodayTask" SET "deferralReason" = "outcome" WHERE "status" = 'DEFERRED';

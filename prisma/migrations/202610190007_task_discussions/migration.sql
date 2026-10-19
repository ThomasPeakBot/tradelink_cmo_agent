ALTER TABLE "ChatMessage" ADD COLUMN "taskId" TEXT;
CREATE INDEX "ChatMessage_userId_taskId_createdAt_idx" ON "ChatMessage"("userId", "taskId", "createdAt");

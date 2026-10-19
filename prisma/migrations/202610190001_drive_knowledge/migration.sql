CREATE TABLE "DriveSync" (
 "folderId" TEXT NOT NULL PRIMARY KEY, "folderName" TEXT NOT NULL,
 "syncedAt" TIMESTAMP(3) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "skipped" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "DriveDocument" (
 "id" TEXT NOT NULL PRIMARY KEY, "folderId" TEXT NOT NULL, "fileId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "path" TEXT NOT NULL, "modifiedAt" TIMESTAMP(3) NOT NULL,
 "syncedAt" TIMESTAMP(3) NOT NULL, "content" TEXT NOT NULL, "truncated" BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX "DriveDocument_folderId_fileId_key" ON "DriveDocument"("folderId", "fileId");

-- AlterTable
ALTER TABLE "GateCommand" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GateCommand_status_issuedAt_idx" ON "GateCommand"("status", "issuedAt");

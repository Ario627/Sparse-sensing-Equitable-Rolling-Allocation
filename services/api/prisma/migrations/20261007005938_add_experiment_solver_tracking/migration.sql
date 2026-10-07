/*
  Warnings:

  - A unique constraint covering the columns `[solverExperimentId]` on the table `Experiment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN     "progressJson" JSONB,
ADD COLUMN     "runsTotal" INTEGER,
ADD COLUMN     "solverExperimentId" TEXT;

-- CreateIndex
CREATE INDEX "Event_type_acknowledgedAt_idx" ON "Event"("type", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_solverExperimentId_key" ON "Experiment"("solverExperimentId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

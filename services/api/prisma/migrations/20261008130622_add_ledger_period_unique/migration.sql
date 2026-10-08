/*
  Warnings:

  - A unique constraint covering the columns `[networkId,blockId,periodStart]` on the table `ServiceLedger` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "ServiceLedger_networkId_blockId_periodStart_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ServiceLedger_networkId_blockId_periodStart_key" ON "ServiceLedger"("networkId", "blockId", "periodStart");

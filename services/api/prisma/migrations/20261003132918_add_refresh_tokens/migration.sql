-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'RESEARCHER', 'VIEWER');

-- CreateEnum
CREATE TYPE "Topology" AS ENUM ('CHAIN', 'BRANCHED', 'MIXED');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('SOURCE', 'JUNCTION', 'GATE', 'BLOCK_TERMINAL');

-- CreateEnum
CREATE TYPE "LossZone" AS ENUM ('HEAD', 'MIDDLE', 'TAIL');

-- CreateEnum
CREATE TYPE "SensorType" AS ENUM ('WATER_LEVEL', 'FLOW', 'PRESSURE', 'SOIL_MOISTURE', 'GATE_POSITION');

-- CreateEnum
CREATE TYPE "ReadingQuality" AS ENUM ('GOOD', 'SUSPECT', 'BAD', 'STALE');

-- CreateEnum
CREATE TYPE "CropStage" AS ENUM ('LAND_PREPARATION', 'VEGETATIVE', 'TILLERING', 'PANICLE_INITIATION', 'FLOWERING', 'GRAIN_FILLING', 'RIPENING');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PROPOSED', 'APPROVED', 'EXECUTED', 'SUPERSEDED', 'FALLBACK');

-- CreateEnum
CREATE TYPE "PolicyProfile" AS ENUM ('EQUITY_FIRST', 'SHORTAGE_FIRST', 'BALANCED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_CHANGES');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "P3A" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "P3A_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "p3aId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IrrigationNetwork" (
    "id" TEXT NOT NULL,
    "p3aId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "topology" "Topology" NOT NULL DEFAULT 'MIXED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IrrigationNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "type" "NodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "orderIdx" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Edge" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "lengthM" DOUBLE PRECISION,
    "capacityLps" DOUBLE PRECISION NOT NULL,
    "zone" "LossZone" NOT NULL DEFAULT 'MIDDLE',

    CONSTRAINT "Edge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areaM2" DOUBLE PRECISION NOT NULL,
    "cropType" TEXT NOT NULL DEFAULT 'paddy',
    "nominalFlowLps" DOUBLE PRECISION NOT NULL,
    "distanceFromSourceM" DOUBLE PRECISION,
    "soilType" TEXT,
    "metadata" JSONB,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sensor" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "nodeId" TEXT,
    "deviceId" TEXT NOT NULL,
    "type" "SensorType" NOT NULL,
    "unit" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3),
    "calibration" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Sensor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensorReading" (
    "id" BIGSERIAL NOT NULL,
    "sensorId" TEXT NOT NULL,
    "blockId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "quality" "ReadingQuality" NOT NULL DEFAULT 'GOOD',
    "seq" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensorReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CropState" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "stage" "CropStage" NOT NULL,
    "kc" DOUBLE PRECISION NOT NULL,
    "etcMmPerDay" DOUBLE PRECISION NOT NULL,
    "percMmPerDay" DOUBLE PRECISION,
    "wlrMm" DOUBLE PRECISION,
    "storageMm" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'kp01',

    CONSTRAINT "CropState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateEstimate" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "blockId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL,
    "stateVector" JSONB NOT NULL,
    "covariance" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "method" TEXT NOT NULL DEFAULT 'mvp-kalman',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StateEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossParameter" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "zone" "LossZone" NOT NULL,
    "etaMean" DOUBLE PRECISION NOT NULL,
    "etaLower" DOUBLE PRECISION NOT NULL,
    "etaUpper" DOUBLE PRECISION NOT NULL,
    "identified" BOOLEAN NOT NULL DEFAULT false,
    "identifiabilityJson" JSONB,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LossParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherForecast" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "rainfallMm" DOUBLE PRECISION,
    "et0Mm" DOUBLE PRECISION,
    "tempC" DOUBLE PRECISION,
    "payload" JSONB,

    CONSTRAINT "WeatherForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceLedger" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "targetFairM3" DOUBLE PRECISION NOT NULL,
    "targetReqM3" DOUBLE PRECISION NOT NULL,
    "deliveredM3" DOUBLE PRECISION NOT NULL,
    "serviceRatio" DOUBLE PRECISION NOT NULL,
    "debtM3" DOUBLE PRECISION NOT NULL,
    "debtCapped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'PROPOSED',
    "profile" "PolicyProfile" NOT NULL DEFAULT 'BALANCED',
    "horizonFrom" TIMESTAMP(3) NOT NULL,
    "horizonTo" TIMESTAMP(3) NOT NULL,
    "solverName" TEXT,
    "solverTimeMs" INTEGER,
    "mipGap" DOUBLE PRECISION,
    "objectiveJson" JSONB,
    "bindingFactors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "gateOpen" BOOLEAN NOT NULL,
    "volumeDelM3" DOUBLE PRECISION,
    "volumeGrossM3" DOUBLE PRECISION,
    "serviceRatioEst" DOUBLE PRECISION,
    "reasonJson" JSONB,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanScenario" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "PlanScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Override" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateCommand" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT,
    "planItemId" TEXT,
    "commandId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "GateCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateFeedback" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "commandId" TEXT,
    "positionPct" DOUBLE PRECISION,
    "flowLps" DOUBLE PRECISION,
    "ts" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,

    CONSTRAINT "GateFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "planId" TEXT,
    "networkId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "networkId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "configYaml" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'QUEUED',
    "seedBase" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentRun" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "runIndex" INTEGER NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "sensorCount" INTEGER NOT NULL,
    "topology" "Topology" NOT NULL,
    "kFactor" DOUBLE PRECISION,
    "metricsJson" JSONB NOT NULL,
    "parquetPath" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ExperimentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentMetric" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,

    CONSTRAINT "ExperimentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_familyId_idx" ON "RefreshToken"("userId", "familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_p3aId_key" ON "Membership"("userId", "p3aId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_nodeId_key" ON "Block"("nodeId");

-- CreateIndex
CREATE INDEX "Sensor_deviceId_idx" ON "Sensor"("deviceId");

-- CreateIndex
CREATE INDEX "SensorReading_sensorId_ts_idx" ON "SensorReading"("sensorId", "ts");

-- CreateIndex
CREATE INDEX "SensorReading_ts_idx" ON "SensorReading"("ts");

-- CreateIndex
CREATE UNIQUE INDEX "SensorReading_sensorId_ts_seq_key" ON "SensorReading"("sensorId", "ts", "seq");

-- CreateIndex
CREATE INDEX "CropState_blockId_ts_idx" ON "CropState"("blockId", "ts");

-- CreateIndex
CREATE INDEX "StateEstimate_networkId_ts_idx" ON "StateEstimate"("networkId", "ts");

-- CreateIndex
CREATE INDEX "LossParameter_networkId_zone_validFrom_idx" ON "LossParameter"("networkId", "zone", "validFrom");

-- CreateIndex
CREATE INDEX "WeatherForecast_networkId_validFrom_idx" ON "WeatherForecast"("networkId", "validFrom");

-- CreateIndex
CREATE INDEX "ServiceLedger_networkId_blockId_periodStart_idx" ON "ServiceLedger"("networkId", "blockId", "periodStart");

-- CreateIndex
CREATE INDEX "Plan_networkId_status_idx" ON "Plan"("networkId", "status");

-- CreateIndex
CREATE INDEX "PlanItem_planId_slotStart_idx" ON "PlanItem"("planId", "slotStart");

-- CreateIndex
CREATE UNIQUE INDEX "PlanScenario_planId_scenarioId_key" ON "PlanScenario"("planId", "scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "GateCommand_commandId_key" ON "GateCommand"("commandId");

-- CreateIndex
CREATE INDEX "GateCommand_issuedAt_idx" ON "GateCommand"("issuedAt");

-- CreateIndex
CREATE INDEX "GateFeedback_sensorId_ts_idx" ON "GateFeedback"("sensorId", "ts");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Experiment_status_createdAt_idx" ON "Experiment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ExperimentRun_experimentId_method_idx" ON "ExperimentRun"("experimentId", "method");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentRun_experimentId_runIndex_key" ON "ExperimentRun"("experimentId", "runIndex");

-- CreateIndex
CREATE INDEX "ExperimentMetric_runId_name_idx" ON "ExperimentMetric"("runId", "name");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_p3aId_fkey" FOREIGN KEY ("p3aId") REFERENCES "P3A"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IrrigationNetwork" ADD CONSTRAINT "IrrigationNetwork_p3aId_fkey" FOREIGN KEY ("p3aId") REFERENCES "P3A"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Edge" ADD CONSTRAINT "Edge_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Edge" ADD CONSTRAINT "Edge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Edge" ADD CONSTRAINT "Edge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensorReading" ADD CONSTRAINT "SensorReading_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensorReading" ADD CONSTRAINT "SensorReading_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropState" ADD CONSTRAINT "CropState_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateEstimate" ADD CONSTRAINT "StateEstimate_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossParameter" ADD CONSTRAINT "LossParameter_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherForecast" ADD CONSTRAINT "WeatherForecast_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceLedger" ADD CONSTRAINT "ServiceLedger_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceLedger" ADD CONSTRAINT "ServiceLedger_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanScenario" ADD CONSTRAINT "PlanScenario_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Override" ADD CONSTRAINT "Override_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Override" ADD CONSTRAINT "Override_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateCommand" ADD CONSTRAINT "GateCommand_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateFeedback" ADD CONSTRAINT "GateFeedback_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "IrrigationNetwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentRun" ADD CONSTRAINT "ExperimentRun_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentMetric" ADD CONSTRAINT "ExperimentMetric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExperimentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

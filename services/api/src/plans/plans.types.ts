import type {
  ApprovalAction,
  LossZone,
  NodeType,
  PlanStatus,
  PolicyProfile,
  Prisma,
  Topology,
} from '../generated/prisma/client.ts';
import type {
  SolverForecastEntry,
  SolverLedgerEntry,
  SolverStateEntry,
} from '../solver/solver.client.ts';

export type PlanDecisionAction = 'approve' | 'reject' | 'request_changes';

export interface PlanSummaryRecord {
  readonly id: string;
  readonly networkId: string;
  readonly networkName: string;
  readonly status: PlanStatus;
  readonly profile: PolicyProfile;
  readonly horizonFrom: Date;
  readonly horizonTo: Date;
  readonly solverName: string | null;
  readonly solverTimeMs: number | null;
  readonly mipGap: number | null;
  readonly itemCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PlanItemRecord {
  readonly id: string;
  readonly blockId: string;
  readonly blockName: string;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly gateOpen: boolean;
  readonly volumeDelM3: number | null;
  readonly volumeGrossM3: number | null;
  readonly serviceRatioEst: number | null;
  readonly reasonJson: Prisma.JsonValue | null;
}

export interface PlanApprovalRecord {
  readonly id: string;
  readonly userId: string;
  readonly userName: string;
  readonly userEmail: string;
  readonly action: ApprovalAction;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export interface PlanOverrideRecord {
  readonly id: string;
  readonly userId: string;
  readonly userName: string;
  readonly reason: string;
  readonly changes: Prisma.JsonValue;
  readonly createdAt: Date;
}

export interface PlanDetailRecord extends PlanSummaryRecord {
  readonly items: readonly PlanItemRecord[];
  readonly approvals: readonly PlanApprovalRecord[];
  readonly overrides: readonly PlanOverrideRecord[];
  readonly objective: Prisma.JsonValue | null;
  readonly bindingFactors: Prisma.JsonValue | null;
}

export interface PlanListQuery {
  readonly networkId?: string;
  readonly status?: PlanStatus;
  readonly page: number;
  readonly limit: number;
}

export interface PlanListPage {
  readonly items: readonly PlanSummaryRecord[];
  readonly total: number;
}

export interface ProposePlanInput {
  readonly networkId: string;
  readonly profile: PolicyProfile;
  readonly horizonH?: number;
}

export interface PlanDecisionInput {
  readonly action: PlanDecisionAction;
  readonly reason?: string;
}

export interface PlanOverrideItemChange {
  readonly itemId: string;
  readonly gateOpen: boolean;
}

export interface PlanOverrideInput {
  readonly reason: string;
  readonly items: readonly PlanOverrideItemChange[];
}

export interface PlanNetworkInfo {
  readonly id: string;
  readonly name: string;
  readonly topology: Topology;
}

export interface PlanNetworkNode {
  readonly id: string;
  readonly type: NodeType;
  readonly name: string;
  readonly orderIdx: number | null;
}

export interface PlanNetworkEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly capacityLps: number;
  readonly zone: LossZone;
  readonly lengthM: number | null;
}

export interface PlanNetworkBlock {
  readonly id: string;
  readonly nodeId: string;
  readonly name: string;
  readonly areaM2: number;
  readonly cropType: string;
  readonly nominalFlowLps: number;
  readonly distanceFromSourceM: number | null;
}

export interface PlanProposalData {
  readonly network: PlanNetworkInfo;
  readonly nodes: readonly PlanNetworkNode[];
  readonly edges: readonly PlanNetworkEdge[];
  readonly blocks: readonly PlanNetworkBlock[];
  readonly ledger: readonly SolverLedgerEntry[];
  readonly forecasts: readonly SolverForecastEntry[];
  readonly state: readonly SolverStateEntry[] | null;
}

export interface FallbackPlanItem {
  readonly blockId: string;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly gateOpen: boolean;
  readonly volumeDelM3: number | null;
  readonly volumeGrossM3: number | null;
  readonly serviceRatioEst: number | null;
  readonly reasonJson: Prisma.JsonValue | null;
}

export interface FallbackPlanData {
  readonly sourcePlanId: string;
  readonly items: readonly FallbackPlanItem[];
}


import { randomUUID } from 'node:crypto';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  LossZone,
  NetworkSortField,
  NodeType,
  SortOrder,
  Topology,
} from '@sera/contracts';
import type { AuditContext } from '../common/audit/audit-context.ts';
import { Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';

const NETWORK_NOT_FOUND_MESSAGE = 'Network not found';
const INVALID_GRAPH_MESSAGE = 'Invalid network graph';
const NODE_ID_CONFLICT_MESSAGE = 'Node id already exists';
const SENSOR_ATTACHED_MESSAGE = 'Node still has a sensor attached';
const OPERATIONAL_DATA_MESSAGE =
  'Network has operational data; create a new network instead';
const DEPENDENT_DATA_MESSAGE =
  'Network still has dependent data; remove it before deleting';
const P3A_NOT_FOUND_MESSAGE = 'P3A not found';
const NETWORK_ENTITY = 'IrrigationNetwork';
const CREATE_AUDIT_ACTION = 'network.create';
const UPDATE_AUDIT_ACTION = 'network.update';
const REPLACE_AUDIT_ACTION = 'network.graph_replace';
const DELETE_AUDIT_ACTION = 'network.delete';

const UPDATE_FIELDS = ['name', 'description', 'topology'] as const;
const REPLACE_BLOCKING_KEYS = [
  'plans',
  'ledgerRows',
  'estimates',
  'lossParameters',
  'cropStates',
  'readings',
] as const;
const DELETE_BLOCKING_KEYS = [
  ...REPLACE_BLOCKING_KEYS,
  'sensors',
  'experiments',
] as const;

export type UpdateField = (typeof UPDATE_FIELDS)[number];

export interface GraphNode {
  readonly id: string;
  readonly type: NodeType;
  readonly name: string;
  readonly orderIdx: number | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface GraphEdge {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly lengthM: number | null;
  readonly capacityLps: number;
  readonly zone: LossZone;
}

export interface GraphBlock {
  readonly nodeId: string;
  readonly name: string;
  readonly areaM2: number;
  readonly cropType: string;
  readonly nominalFlowLps: number;
  readonly distanceFromSourceM: number | null;
  readonly soilType: string | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface NetworkGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly blocks: readonly GraphBlock[];
}

export interface NetworkListQuery {
  readonly search?: string;
  readonly topology?: Topology;
  readonly page: number;
  readonly limit: number;
  readonly sort: NetworkSortField;
  readonly order: SortOrder;
}

export interface NetworkCreateInput {
  readonly name: string;
  readonly description: string | null;
  readonly topology: Topology;
  readonly p3aId: string | null;
  readonly graph: NetworkGraph;
}

export interface NetworkGraphInput {
  readonly topology: Topology;
  readonly graph: NetworkGraph;
}

export interface NetworkMetadataChanges {
  readonly name?: string;
  readonly description?: string | null;
  readonly topology?: Topology;
}

export interface NetworkSummaryRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly topology: Topology;
  readonly p3aId: string | null;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly blockCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NetworkNodeRecord {
  readonly id: string;
  readonly type: NodeType;
  readonly name: string;
  readonly orderIdx: number | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface NetworkEdgeRecord {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly lengthM: number | null;
  readonly capacityLps: number;
  readonly zone: LossZone;
}

export interface NetworkBlockRecord {
  readonly id: string;
  readonly nodeId: string;
  readonly name: string;
  readonly areaM2: number;
  readonly cropType: string;
  readonly nominalFlowLps: number;
  readonly distanceFromSourceM: number | null;
  readonly soilType: string | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface NetworkDetailRecord extends NetworkSummaryRecord {
  readonly nodes: readonly NetworkNodeRecord[];
  readonly edges: readonly NetworkEdgeRecord[];
  readonly blocks: readonly NetworkBlockRecord[];
}

export interface NetworkPage {
  readonly items: readonly NetworkSummaryRecord[];
  readonly total: number;
}

export interface NetworkDependencies {
  readonly plans: number;
  readonly sensors: number;
  readonly experiments: number;
  readonly ledgerRows: number;
  readonly estimates: number;
  readonly lossParameters: number;
  readonly cropStates: number;
  readonly readings: number;
}

interface NetworkMetadataState {
  readonly name: string;
  readonly description: string | null;
  readonly topology: Topology;
}

interface SourceCheck {
  readonly sourceId: string | null;
  readonly issues: string[];
}

type NodeData = Pick<
  Prisma.NodeUncheckedCreateInput,
  'type' | 'name' | 'orderIdx' | 'metadata'
>;
type EdgeData = Pick<
  Prisma.EdgeUncheckedCreateInput,
  'fromNodeId' | 'toNodeId' | 'lengthM' | 'capacityLps' | 'zone'
>;
type BlockData = Pick<
  Prisma.BlockUncheckedCreateInput,
  | 'nodeId'
  | 'name'
  | 'areaM2'
  | 'cropType'
  | 'nominalFlowLps'
  | 'distanceFromSourceM'
  | 'soilType'
  | 'metadata'
>;

const SUMMARY_SELECT = {
  id: true,
  name: true,
  description: true,
  topology: true,
  p3aId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { nodes: true, edges: true, blocks: true } },
} satisfies Prisma.IrrigationNetworkSelect;

type SummaryRow = Prisma.IrrigationNetworkGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

const NODE_SELECT = {
  id: true,
  type: true,
  name: true,
  orderIdx: true,
  metadata: true,
} satisfies Prisma.NodeSelect;

type NodeRow = Prisma.NodeGetPayload<{ select: typeof NODE_SELECT }>;

const EDGE_SELECT = {
  id: true,
  fromNodeId: true,
  toNodeId: true,
  lengthM: true,
  capacityLps: true,
  zone: true,
} satisfies Prisma.EdgeSelect;

type EdgeRow = Prisma.EdgeGetPayload<{ select: typeof EDGE_SELECT }>;

const BLOCK_SELECT = {
  id: true,
  nodeId: true,
  name: true,
  areaM2: true,
  cropType: true,
  nominalFlowLps: true,
  distanceFromSourceM: true,
  soilType: true,
  metadata: true,
} satisfies Prisma.BlockSelect;

type BlockRow = Prisma.BlockGetPayload<{ select: typeof BLOCK_SELECT }>;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  nodes: {
    select: NODE_SELECT,
    orderBy: [{ orderIdx: 'asc' }, { id: 'asc' }],
  },
  edges: { select: EDGE_SELECT, orderBy: { id: 'asc' } },
  blocks: { select: BLOCK_SELECT, orderBy: { name: 'asc' } },
} satisfies Prisma.IrrigationNetworkSelect;

type DetailRow = Prisma.IrrigationNetworkGetPayload<{
  select: typeof DETAIL_SELECT;
}>;

function summarize(values: readonly string[], limit = 5): string {
  const head = values.slice(0, limit).join(', ');
  return values.length > limit
    ? `${head}, +${values.length - limit} more`
    : head;
}

function collectDuplicates<T, K>(
  items: readonly T[],
  keyOf: (value: T) => K,
): K[] {
  const seen = new Set<K>();
  const duplicated = new Set<K>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) {
      duplicated.add(key);
    } else {
      seen.add(key);
    }
  }
  return [...duplicated];
}

function toMetadata(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toJsonInput(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function toSummary(row: SummaryRow): NetworkSummaryRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    topology: row.topology,
    p3aId: row.p3aId,
    nodeCount: row._count.nodes,
    edgeCount: row._count.edges,
    blockCount: row._count.blocks,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toNodeRecord(row: NodeRow): NetworkNodeRecord {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    orderIdx: row.orderIdx,
    metadata: toMetadata(row.metadata),
  };
}

function toEdgeRecord(row: EdgeRow): NetworkEdgeRecord {
  return {
    id: row.id,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    lengthM: row.lengthM,
    capacityLps: row.capacityLps,
    zone: row.zone,
  };
}

function toBlockRecord(row: BlockRow): NetworkBlockRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    name: row.name,
    areaM2: row.areaM2,
    cropType: row.cropType,
    nominalFlowLps: row.nominalFlowLps,
    distanceFromSourceM: row.distanceFromSourceM,
    soilType: row.soilType,
    metadata: toMetadata(row.metadata),
  };
}

function toDetail(row: DetailRow): NetworkDetailRecord {
  return {
    ...toSummary(row),
    nodes: row.nodes.map(toNodeRecord),
    edges: row.edges.map(toEdgeRecord),
    blocks: row.blocks.map(toBlockRecord),
  };
}

function toNodeData(node: GraphNode): NodeData {
  return {
    type: node.type,
    name: node.name,
    orderIdx: node.orderIdx,
    metadata: toJsonInput(node.metadata),
  };
}

function toEdgeData(edge: GraphEdge): EdgeData {
  return {
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    lengthM: edge.lengthM,
    capacityLps: edge.capacityLps,
    zone: edge.zone,
  };
}

function toBlockData(block: GraphBlock): BlockData {
  return {
    nodeId: block.nodeId,
    name: block.name,
    areaM2: block.areaM2,
    cropType: block.cropType,
    nominalFlowLps: block.nominalFlowLps,
    distanceFromSourceM: block.distanceFromSourceM,
    soilType: block.soilType,
    metadata: toJsonInput(block.metadata),
  };
}

function countByEndpoint(
  edges: readonly {
    readonly fromNodeId: string;
    readonly toNodeId: string;
  }[],
  endpoint: 'fromNodeId' | 'toNodeId',
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    const key = edge[endpoint];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function buildAdjacency(edges: readonly GraphEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.fromNodeId);
    if (targets === undefined) {
      adjacency.set(edge.fromNodeId, [edge.toNodeId]);
    } else {
      targets.push(edge.toNodeId);
    }
  }
  return adjacency;
}

function collectReachable(
  adjacency: ReadonlyMap<string, readonly string[]>,
  sourceId: string,
): Set<string> {
  const visited = new Set<string>([sourceId]);
  const queue: string[] = [sourceId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) {
      continue;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

function validateNodeUniqueness(nodes: readonly GraphNode[]): string[] {
  const issues: string[] = [];
  const duplicatedIds = collectDuplicates(nodes, (node) => node.id);
  if (duplicatedIds.length > 0) {
    issues.push(`duplicate node id: ${summarize(duplicatedIds)}`);
  }
  const duplicatedNames = collectDuplicates(nodes, (node) => node.name);
  if (duplicatedNames.length > 0) {
    issues.push(`duplicate node name: ${summarize(duplicatedNames)}`);
  }
  return issues;
}

function validateSourceCount(nodes: readonly GraphNode[]): SourceCheck {
  const sources = nodes.filter((node) => node.type === 'SOURCE');
  const first = sources[0];
  return sources.length === 1 && first !== undefined
    ? { sourceId: first.id, issues: [] }
    : {
        sourceId: null,
        issues: [
          `graph must contain exactly one SOURCE node (found ${sources.length})`,
        ],
      };
}

function validateEdgeStructure(
  edges: readonly GraphEdge[],
  nodeIds: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  const unknown = edges.filter(
    (edge) => !nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId),
  );
  if (unknown.length > 0) {
    issues.push(
      `edges reference unknown nodes: ${summarize(
        unknown.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`),
      )}`,
    );
  }
  const selfLoops = edges.filter((edge) => edge.fromNodeId === edge.toNodeId);
  if (selfLoops.length > 0) {
    issues.push(
      `edge cannot loop on the same node: ${summarize(
        selfLoops.map((edge) => edge.fromNodeId),
      )}`,
    );
  }
  const duplicated = collectDuplicates(
    edges,
    (edge) => `${edge.fromNodeId}->${edge.toNodeId}`,
  );
  if (duplicated.length > 0) {
    issues.push(`duplicate edge: ${summarize(duplicated)}`);
  }
  return issues;
}

function validateTree(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  sourceId: string,
): string[] {
  const issues: string[] = [];
  const incoming = countByEndpoint(edges, 'toNodeId');
  for (const node of nodes) {
    const count = incoming.get(node.id) ?? 0;
    if (node.id === sourceId) {
      if (count > 0) {
        issues.push(`SOURCE node ${node.name} must not have incoming edges`);
      }
    } else if (count !== 1) {
      issues.push(
        `node ${node.name} must have exactly one incoming edge (found ${count})`,
      );
    }
  }
  const reachable = collectReachable(buildAdjacency(edges), sourceId);
  const unreachable = nodes.filter((node) => !reachable.has(node.id));
  if (unreachable.length > 0) {
    issues.push(
      `nodes unreachable from SOURCE: ${summarize(
        unreachable.map((node) => node.name),
      )}`,
    );
  }
  return issues;
}

function validateBlocks(
  blocks: readonly GraphBlock[],
  nodes: readonly GraphNode[],
): string[] {
  const issues: string[] = [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const duplicatedNodes = collectDuplicates(blocks, (block) => block.nodeId);
  if (duplicatedNodes.length > 0) {
    issues.push(`duplicate block for node: ${summarize(duplicatedNodes)}`);
  }
  const duplicatedNames = collectDuplicates(blocks, (block) => block.name);
  if (duplicatedNames.length > 0) {
    issues.push(`duplicate block name: ${summarize(duplicatedNames)}`);
  }
  for (const block of blocks) {
    const node = nodeById.get(block.nodeId);
    if (node === undefined) {
      issues.push(
        `block ${block.name} references unknown node ${block.nodeId}`,
      );
    } else if (node.type !== 'BLOCK_TERMINAL') {
      issues.push(
        `block ${block.name} must attach to a BLOCK_TERMINAL node (${node.name} is ${node.type})`,
      );
    }
  }
  const blockNodeIds = new Set(blocks.map((block) => block.nodeId));
  const missing = nodes.filter(
    (node) => node.type === 'BLOCK_TERMINAL' && !blockNodeIds.has(node.id),
  );
  if (missing.length > 0) {
    issues.push(
      `terminal nodes without a block: ${summarize(
        missing.map((node) => node.name),
      )}`,
    );
  }
  return issues;
}

function validateTopologyDeclaration(
  topology: Topology,
  edges: readonly {
    readonly fromNodeId: string;
    readonly toNodeId: string;
  }[],
): string[] {
  const maxOutDegree = Math.max(
    0,
    ...countByEndpoint(edges, 'fromNodeId').values(),
  );
  if (topology === 'CHAIN' && maxOutDegree > 1) {
    return ['CHAIN topology does not allow branching edges'];
  }
  if (topology === 'BRANCHED' && maxOutDegree < 2) {
    return ['BRANCHED topology requires at least one branching node'];
  }
  return [];
}

function validateGraph(topology: Topology, graph: NetworkGraph): string[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const source = validateSourceCount(graph.nodes);
  return [
    ...validateNodeUniqueness(graph.nodes),
    ...source.issues,
    ...validateEdgeStructure(graph.edges, nodeIds),
    ...(source.sourceId === null
      ? []
      : validateTree(graph.nodes, graph.edges, source.sourceId)),
    ...validateBlocks(graph.blocks, graph.nodes),
    ...validateTopologyDeclaration(topology, graph.edges),
  ];
}

function assertGraphValid(topology: Topology, graph: NetworkGraph): void {
  const issues = validateGraph(topology, graph);
  if (issues.length > 0) {
    throw new BadRequestException({ message: INVALID_GRAPH_MESSAGE, issues });
  }
}

function buildNetworkWhere(
  query: NetworkListQuery,
): Prisma.IrrigationNetworkWhereInput {
  const search = query.search;
  return {
    ...(query.topology === undefined ? {} : { topology: query.topology }),
    ...(search === undefined
      ? {}
      : {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }),
  };
}

const NETWORK_SORT_BUILDERS: Readonly<
  Record<
    NetworkSortField,
    (order: SortOrder) => Prisma.IrrigationNetworkOrderByWithRelationInput
  >
> = {
  created_at: (order) => ({ createdAt: order }),
  updated_at: (order) => ({ updatedAt: order }),
  name: (order) => ({ name: order }),
};

function buildNetworkOrderBy(
  sort: NetworkSortField,
  order: SortOrder,
): Prisma.IrrigationNetworkOrderByWithRelationInput[] {
  return [NETWORK_SORT_BUILDERS[sort](order), { id: 'asc' }];
}

function pickFields(
  source: Readonly<Record<UpdateField, string | null>>,
  fields: readonly UpdateField[],
): Prisma.InputJsonObject {
  return Object.fromEntries(
    fields.map((field) => [field, source[field]] as const),
  );
}

function buildNetworkUpdateData(
  next: NetworkMetadataState,
  changed: readonly UpdateField[],
): Prisma.IrrigationNetworkUncheckedUpdateInput {
  return {
    ...(changed.includes('name') ? { name: next.name } : {}),
    ...(changed.includes('description')
      ? { description: next.description }
      : {}),
    ...(changed.includes('topology') ? { topology: next.topology } : {}),
  };
}

function pickBlocking(
  dependencies: NetworkDependencies,
  keys: readonly (keyof NetworkDependencies)[],
): Partial<NetworkDependencies> {
  return Object.fromEntries(
    keys
      .filter((key) => dependencies[key] > 0)
      .map((key) => [key, dependencies[key]] as const),
  );
}

async function countDependencies(
  tx: Prisma.TransactionClient,
  networkId: string,
): Promise<NetworkDependencies> {
  const [
    plans,
    sensors,
    experiments,
    ledgerRows,
    estimates,
    lossParameters,
    cropStates,
    readings,
  ] = await Promise.all([
    tx.plan.count({ where: { networkId } }),
    tx.sensor.count({ where: { networkId } }),
    tx.experiment.count({ where: { networkId } }),
    tx.serviceLedger.count({ where: { networkId } }),
    tx.stateEstimate.count({ where: { networkId } }),
    tx.lossParameter.count({ where: { networkId } }),
    tx.cropState.count({ where: { block: { networkId } } }),
    tx.sensorReading.count({
      where: { OR: [{ sensor: { networkId } }, { block: { networkId } }] },
    }),
  ]);
  return {
    plans,
    sensors,
    experiments,
    ledgerRows,
    estimates,
    lossParameters,
    cropStates,
    readings,
  };
}

async function assertNodeIdsAvailable(
  tx: Prisma.TransactionClient,
  networkId: string | null,
  nodeIds: readonly string[],
): Promise<void> {
  if (nodeIds.length === 0) {
    return;
  }

  const conflicts = await tx.node.findMany({
    where: {
      id: { in: [...nodeIds] },
      ...(networkId === null ? {} : { networkId: { not: networkId } }),
    },
    select: { id: true },
  });

  if (conflicts.length > 0) {
    throw new ConflictException({
      message: NODE_ID_CONFLICT_MESSAGE,
      nodeIds: conflicts.map((node) => node.id),
    });
  }
}

async function assertNodesDetachable(
  tx: Prisma.TransactionClient,
  nodes: readonly { readonly id: string; readonly name: string }[],
): Promise<void> {
  const attached = await tx.sensor.findMany({
    where: { nodeId: { in: nodes.map((node) => node.id) } },
    select: { nodeId: true },
  });
  if (attached.length === 0) {
    return;
  }
  const attachedNodeIds = new Set(
    attached.flatMap((sensor) =>
      sensor.nodeId === null ? [] : [sensor.nodeId],
    ),
  );
  throw new ConflictException({
    message: SENSOR_ATTACHED_MESSAGE,
    nodes: nodes
      .filter((node) => attachedNodeIds.has(node.id))
      .map((node) => node.name),
  });
}

async function assertTopologyMatchesGraph(
  tx: Prisma.TransactionClient,
  networkId: string,
  topology: Topology,
): Promise<void> {
  const edges = await tx.edge.findMany({
    where: { networkId },
    select: { fromNodeId: true, toNodeId: true },
  });
  const issues = validateTopologyDeclaration(topology, edges);
  if (issues.length > 0) {
    throw new BadRequestException({ message: INVALID_GRAPH_MESSAGE, issues });
  }
}

async function insertGraph(
  tx: Prisma.TransactionClient,
  networkId: string,
  graph: NetworkGraph,
): Promise<void> {
  await tx.node.createMany({
    data: graph.nodes.map((node) => ({
      id: node.id,
      networkId,
      ...toNodeData(node),
    })),
  });
  await tx.edge.createMany({
    data: graph.edges.map((edge) => ({
      id: randomUUID(),
      networkId,
      ...toEdgeData(edge),
    })),
  });
  await tx.block.createMany({
    data: graph.blocks.map((block) => ({
      id: randomUUID(),
      networkId,
      ...toBlockData(block),
    })),
  });
}

@Injectable()
export class NetworkService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: NetworkListQuery): Promise<NetworkPage> {
    const where = buildNetworkWhere(query);
    const orderBy = buildNetworkOrderBy(query.sort, query.order);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.irrigationNetwork.count({ where }),
      this.prisma.irrigationNetwork.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: SUMMARY_SELECT,
      }),
    ]);
    return { items: rows.map(toSummary), total };
  }

  async getById(id: string): Promise<NetworkDetailRecord> {
    const network = await this.prisma.irrigationNetwork.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });

    if (network === null) {
      throw new NotFoundException({
        message: NETWORK_NOT_FOUND_MESSAGE,
        networkId: id,
      });
    }

    return toDetail(network);
  }

  async create(
    actorId: string,
    input: NetworkCreateInput,
    audit: AuditContext,
  ): Promise<NetworkDetailRecord> {
    assertGraphValid(input.topology, input.graph);
    const newtworkId = await this.prisma.$transaction(async (tx) => {
      if (input.p3aId !== null) {
        const p3a = await tx.p3A.findUnique({
          where: { id: input.p3aId },
          select: { id: true },
        });

        if (p3a === null) {
          throw new NotFoundException({
            message: P3A_NOT_FOUND_MESSAGE,
            p3aId: input.p3aId,
          });
        }
      }

      await assertNodeIdsAvailable(
        tx,
        null,
        input.graph.nodes.map((node) => node.id),
      );

      const network = await tx.irrigationNetwork.create({
        data: {
          name: input.name,
          description: input.description,
          topology: input.topology,
          p3aId: input.p3aId,
        },
        select: { id: true },
      });

      await insertGraph(tx, network.id, input.graph);

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: CREATE_AUDIT_ACTION,
          entity: NETWORK_ENTITY,
          entityId: network.id,
          after: {
            name: input.name,
            topology: input.topology,
            nodes: input.graph.nodes.length,
            edges: input.graph.edges.length,
            blocks: input.graph.blocks.length,
          },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
      return network.id;
    });
    return this.getById(newtworkId);
  }

  async update(
    actorId: string,
    id: string,
    changes: NetworkMetadataChanges,
    audit: AuditContext,
  ): Promise<NetworkSummaryRecord> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.irrigationNetwork.findUnique({
        where: { id },
        select: { name: true, description: true, topology: true },
      });

      if (current === null) {
        throw new NotFoundException({
          message: NETWORK_NOT_FOUND_MESSAGE,
          networkId: id,
        });
      }

      const next: NetworkMetadataState = {
        name: changes.name ?? current.name,
        description:
          changes.description === undefined
            ? current.description
            : changes.description,
        topology: changes.topology ?? current.topology,
      };

      const changed = UPDATE_FIELDS.filter(
        (field) => current[field] !== next[field],
      );

      if (changed.length === 0) {
        return;
      }

      if (changed.includes('topology')) {
        await assertTopologyMatchesGraph(tx, id, next.topology);
      }

      await tx.irrigationNetwork.update({
        where: { id },
        data: buildNetworkUpdateData(next, changed),
      });

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: UPDATE_AUDIT_ACTION,
          entity: NETWORK_ENTITY,
          entityId: id,
          before: pickFields(current, changed),
          after: pickFields(next, changed),
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
    });

    return this.getSummaryOrThrow(id);
  }

  async replaceGraph(
    actorId: string,
    id: string,
    input: NetworkGraphInput,
    audit: AuditContext,
  ): Promise<NetworkDetailRecord> {
    assertGraphValid(input.topology, input.graph);
    await this.prisma.$transaction(async (tx) => {
      const network = await tx.irrigationNetwork.findUnique({
        where: { id },
        select: { id: true, topology: true },
      });

      if (network === null) {
        throw new NotFoundException({ message: NETWORK_NOT_FOUND_MESSAGE });
      }

      const dependencies = await countDependencies(tx, id);
      const blocking = pickBlocking(dependencies, REPLACE_BLOCKING_KEYS);
      if (Object.keys(blocking).length > 0) {
        throw new ConflictException({
          message: OPERATIONAL_DATA_MESSAGE,
          dependencies: blocking,
        });
      }
      const existingNodes = await tx.node.findMany({
        where: { networkId: id },
        select: { id: true, name: true },
      });

      const existingEdges = await tx.edge.count({ where: { networkId: id } });
      const existingBlocks = await tx.block.count({
        where: { networkId: id },
      });
      const existingIds = new Set(existingNodes.map((node) => node.id));
      const payloadIds = new Set(input.graph.nodes.map((node) => node.id));
      const addedIds = input.graph.nodes
        .filter((node) => !existingIds.has(node.id))
        .map((node) => node.id);
      const removedNodes = existingNodes.filter(
        (node) => !payloadIds.has(node.id),
      );
      await assertNodeIdsAvailable(tx, id, addedIds);
      if (removedNodes.length > 0) {
        await assertNodesDetachable(tx, removedNodes);
      }
      const payloadBlockNodeIds = input.graph.blocks.map(
        (block) => block.nodeId,
      );
      const blockRows = await tx.block.findMany({
        where: { networkId: id, nodeId: { in: payloadBlockNodeIds } },
        select: { id: true, nodeId: true },
      });
      const blockIdByNodeId = new Map(
        blockRows.map((block) => [block.nodeId, block.id]),
      );
      await tx.edge.deleteMany({ where: { networkId: id } });
      await tx.block.deleteMany({
        where: { networkId: id, nodeId: { notIn: payloadBlockNodeIds } },
      });
      if (removedNodes.length > 0) {
        await tx.node.deleteMany({
          where: { id: { in: removedNodes.map((node) => node.id) } },
        });
      }

      for (const node of input.graph.nodes) {
        if (existingIds.has(node.id)) {
          await tx.node.update({
            where: { id: node.id },
            data: toNodeData(node),
          });
        } else {
          await tx.node.create({
            data: { id: node.id, networkId: id, ...toNodeData(node) },
          });
        }
      }

      for (const block of input.graph.blocks) {
        const existingBlockId = blockIdByNodeId.get(block.nodeId);
        if (existingBlockId === undefined) {
          await tx.block.create({
            data: { id: randomUUID(), networkId: id, ...toBlockData(block) },
          });
        } else {
          await tx.block.update({
            where: { id: existingBlockId },
            data: toBlockData(block),
          });
        }
      }

      await tx.edge.createMany({
        data: input.graph.edges.map((edge) => ({
          id: randomUUID(),
          networkId: id,
          ...toEdgeData(edge),
        })),
      });

      if (network.topology !== input.topology) {
        await tx.irrigationNetwork.update({
          where: { id },
          data: { topology: input.topology },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: REPLACE_AUDIT_ACTION,
          entity: NETWORK_ENTITY,
          entityId: id,
          before: {
            topology: network.topology,
            nodes: existingNodes.length,
            edges: existingEdges,
            blocks: existingBlocks,
          },
          after: {
            topology: input.topology,
            nodes: input.graph.nodes.length,
            edges: input.graph.edges.length,
            blocks: input.graph.blocks.length,
          },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
    });

    return this.getById(id);
  }

  async remove(
    actorId: string,
    id: string,
    audit: AuditContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const network = await tx.irrigationNetwork.findUnique({
        where: { id },
        select: { name: true, topology: true },
      });
      if (network === null) {
        throw new NotFoundException(NETWORK_NOT_FOUND_MESSAGE);
      }
      const dependencies = await countDependencies(tx, id);
      const blocking = pickBlocking(dependencies, DELETE_BLOCKING_KEYS);
      if (Object.keys(blocking).length > 0) {
        throw new ConflictException({
          message: DEPENDENT_DATA_MESSAGE,
          dependencies: blocking,
        });
      }
      await tx.event.deleteMany({ where: { networkId: id } });
      await tx.weatherForecast.deleteMany({ where: { networkId: id } });
      await tx.edge.deleteMany({ where: { networkId: id } });
      await tx.block.deleteMany({ where: { networkId: id } });
      await tx.node.deleteMany({ where: { networkId: id } });
      await tx.irrigationNetwork.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: DELETE_AUDIT_ACTION,
          entity: NETWORK_ENTITY,
          entityId: id,
          before: { name: network.name, topology: network.topology },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
    });
  }

  private async getSummaryOrThrow(id: string): Promise<NetworkSummaryRecord> {
    const network = await this.prisma.irrigationNetwork.findUnique({
      where: { id },
      select: SUMMARY_SELECT,
    });
    if (network === null) {
      throw new NotFoundException(NETWORK_NOT_FOUND_MESSAGE);
    }
    return toSummary(network);
  }
}
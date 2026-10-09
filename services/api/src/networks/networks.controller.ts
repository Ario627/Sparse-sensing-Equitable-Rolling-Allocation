import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/access-token.ts';
import { CurrentUser, Roles } from '../auth/auth.decorators.ts';
import { auditContextFrom } from '../common/audit/audit-context.ts';
import {
  createNetworkRequestSchema,
  listNetworksQuerySchema,
  networkIdSchema,
  replaceNetworkGraphRequestSchema,
  updateNetworkRequestSchema,
  type CreateNetworkRequest,
  type GraphBlockInput,
  type GraphEdgeInput,
  type GraphNodeInput,
  type ListNetworksQuery,
  type NetworkBlockResponse,
  type NetworkDetailResponse,
  type NetworkEdgeResponse,
  type NetworkGraphInput,
  type NetworkNodeResponse,
  type NetworksListResponse,
  type NetworkSummaryResponse,
  type ReplaceNetworkGraphRequest,
  type UpdateNetworkRequest,
} from '@sera/contracts';
import {
  NetworkService,
  type GraphBlock,
  type GraphEdge,
  type GraphNode,
  type NetworkBlockRecord,
  type NetworkDetailRecord,
  type NetworkEdgeRecord,
  type NetworkGraph,
  type NetworkNodeRecord,
  type NetworkSummaryRecord,
} from './networks.service.ts';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

const ADMIN_ROLE = 'ADMIN' as const;
const WRITE_RATE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

function toGraphNode(node: GraphNodeInput): GraphNode {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    orderIdx: node.order_idx ?? null,
    metadata: node.metadata ?? null,
  };
}

function toGraphEdge(edge: GraphEdgeInput): GraphEdge {
  return {
    fromNodeId: edge.from_node_id,
    toNodeId: edge.to_node_id,
    lengthM: edge.length_m ?? null,
    capacityLps: edge.capacity_lps,
    zone: edge.zone,
  };
}

function toGraphBlock(block: GraphBlockInput): GraphBlock {
  return {
    nodeId: block.node_id,
    name: block.name,
    areaM2: block.area_m2,
    cropType: block.crop_type,
    nominalFlowLps: block.nominal_flow_lps,
    distanceFromSourceM: block.distance_from_source_m ?? null,
    soilType: block.soil_type ?? null,
    metadata: block.metadata ?? null,
  };
}

function toGraph(graph: NetworkGraphInput): NetworkGraph {
  return {
    nodes: graph.nodes.map(toGraphNode),
    edges: graph.edges.map(toGraphEdge),
    blocks: graph.blocks.map(toGraphBlock),
  };
}

function toSummaryResponse(
  record: NetworkSummaryRecord,
): NetworkSummaryResponse {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    topology: record.topology,
    p3a_id: record.p3aId,
    node_count: record.nodeCount,
    edge_count: record.edgeCount,
    block_count: record.blockCount,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function toNodeResponse(record: NetworkNodeRecord): NetworkNodeResponse {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    order_idx: record.orderIdx,
    metadata: record.metadata,
  };
}

function toEdgeResponse(record: NetworkEdgeRecord): NetworkEdgeResponse {
  return {
    id: record.id,
    from_node_id: record.fromNodeId,
    to_node_id: record.toNodeId,
    length_m: record.lengthM,
    capacity_lps: record.capacityLps,
    zone: record.zone,
  };
}

function toBlockResponse(record: NetworkBlockRecord): NetworkBlockResponse {
  return {
    id: record.id,
    node_id: record.nodeId,
    name: record.name,
    area_m2: record.areaM2,
    crop_type: record.cropType,
    nominal_flow_lps: record.nominalFlowLps,
    distance_from_source_m: record.distanceFromSourceM,
    soil_type: record.soilType,
    metadata: record.metadata,
  };
}

function toDetailResponse(record: NetworkDetailRecord): NetworkDetailResponse {
  return {
    ...toSummaryResponse(record),
    nodes: record.nodes.map(toNodeResponse),
    edges: record.edges.map(toEdgeResponse),
    blocks: record.blocks.map(toBlockResponse),
  };
}


@Controller('networks')
export class NetworksController {
  constructor(private readonly networksService: NetworkService) {}

  @Get()
  async list(
    @Query({ schema: listNetworksQuerySchema }) query: ListNetworksQuery,
  ): Promise<NetworksListResponse> {
    const page = await this.networksService.list({
      search: query.q,
      topology: query.topology,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
    });
    return {
      items: page.items.map(toSummaryResponse),
      page: query.page,
      limit: query.limit,
      total: page.total,
      total_pages: Math.max(1, Math.ceil(page.total / query.limit)),
    };
  }

  @Get(':id')
  async detail(
    @Param('id', { schema: networkIdSchema }) id: string,
  ): Promise<NetworkDetailResponse> {
    return toDetailResponse(await this.networksService.getById(id));
  }

  @Roles(ADMIN_ROLE)
  @Post()
  @Throttle(WRITE_RATE_LIMIT)
  async create(
    @Body({ schema: createNetworkRequestSchema }) body: CreateNetworkRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<NetworkDetailResponse> {
    const created = await this.networksService.create(
      actor.id,
      {
        name: body.name,
        description: body.description,
        topology: body.topology,
        p3aId: body.p3a_id ?? null,
        graph: toGraph(body.graph),
      },
      auditContextFrom(request),
    );
    return toDetailResponse(created);
  }

  @Roles(ADMIN_ROLE)
  @Patch(':id')
  @Throttle(WRITE_RATE_LIMIT)
  async update(
    @Param('id', { schema: networkIdSchema }) id: string,
    @Body({ schema: updateNetworkRequestSchema }) body: UpdateNetworkRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<NetworkSummaryResponse> {
    const updated = await this.networksService.update(
      actor.id,
      id,
      {
        name: body.name,
        description: body.description,
        topology: body.topology,
      },
      auditContextFrom(request),
    );
    return toSummaryResponse(updated);
  }

  @Roles(ADMIN_ROLE)
  @Put(':id/graph')
  @Throttle(WRITE_RATE_LIMIT)
  async replaceGraph(
    @Param('id', { schema: networkIdSchema }) id: string,
    @Body({ schema: replaceNetworkGraphRequestSchema })
    body: ReplaceNetworkGraphRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<NetworkDetailResponse> {
    const replaced = await this.networksService.replaceGraph(
      actor.id,
      id,
      { topology: body.topology, graph: toGraph(body.graph) },
      auditContextFrom(request),
    );
    return toDetailResponse(replaced);
  }

  @Roles(ADMIN_ROLE)
  @Delete(':id')
  @Throttle(WRITE_RATE_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', { schema: networkIdSchema }) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.networksService.remove(actor.id, id, auditContextFrom(request));
  }
}
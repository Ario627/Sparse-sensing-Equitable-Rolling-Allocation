import { Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {WebSocketGateway, WebSocketServer, type OnGatewayConnection, type OnGatewayDisconnect} from '@nestjs/websockets'
import type { Server, Socket } from "socket.io";
import type { ServerEvent } from "@sera/contracts";
import { extractBearerToken } from "../auth/access-token.ts";
import { verifyAccessToken } from "../auth/auth.guard.ts";
import type { Env } from "../common/config/env.ts";
import { DomainEventBus, type ServerEventDraft } from "../common/events/domain-event-bus.service.ts";

const EVENT_CHANNEL = 'sera.event';
const SCHEMA_VERSION = 1;
const MAX_FRAME_BYTES = 16_384;
const CONNECT_TIMEOUT_MS = 20_000;
const PING_INTERVAL_MS = 25_000;
const PING_TIMEOUT_MS = 20_000;


@WebSocketGateway({
  serveClient: false,
  perMessageDeflate: false,
  maxHttpBufferSize: MAX_FRAME_BYTES,
  connectTimeout: CONNECT_TIMEOUT_MS,
  pingInterval: PING_INTERVAL_MS,
  pingTimeout: PING_TIMEOUT_MS,
})
export class RealtimeGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly allowedOrigins: readonly string[];
  private unsubscribe: (() => void) | undefined;

  @WebSocketServer()
  private server: Server | undefined;

  constructor(
    config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly events: DomainEventBus,
  ) {
    this.allowedOrigins = config.get('CORS_ORIGINS', { infer: true });
  }

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe((event) => {
      this.broadcast(event);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  handleConnection(client: Socket): void {
    void this.authenticate(client);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`realtime client disconnected: ${client.id}`);
  }

  private async authenticate(client: Socket): Promise<void> {
    const origin = client.handshake.headers.origin;
    if (origin !== undefined && !this.allowedOrigins.includes(origin)) {
      this.logger.warn(`realtime connection rejected from origin ${origin}`);
      client.disconnect(true);
      return;
    }
    const token = this.extractToken(client);
    const user =
      token === null ? null : await verifyAccessToken(this.jwt, token);
    if (user === null) {
      this.logger.warn('realtime connection rejected: unauthorized');
      client.disconnect(true);
      return;
    }
    client.data = { userId: user.id, role: user.role };
    this.logger.debug(`realtime client connected: ${client.id}`);
  }

  private extractToken(client: Socket): string | null {
    const fromAuth: unknown = client.handshake.auth.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) {
      return fromAuth;
    }
    return extractBearerToken(client.handshake.headers);
  }

  private broadcast(draft: ServerEventDraft): void {
    const server = this.server;
    if (server === undefined) {
      return;
    }
    const envelope: ServerEvent = {
      schema_version: SCHEMA_VERSION,
      ts: new Date().toISOString(),
      ...draft,
    };
    server.emit(EVENT_CHANNEL, envelope);
  }
}
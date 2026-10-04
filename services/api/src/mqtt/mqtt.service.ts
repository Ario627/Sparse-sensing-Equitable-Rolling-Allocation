import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type MqttClient } from 'mqtt';
import type { Env } from '../common/config/env.ts';

export interface MqttMessage {
  readonly topic: string;
  readonly payload: Buffer;
}

export type MqttMessageHandler = (message: MqttMessage) => Promise<void>;

export interface MqttSubscription {
  readonly topics: readonly string[];
  readonly handler: MqttMessageHandler;
}

const SUBSCRIPTION_QOS = 1;
const KEEPALIVE_SECONDS = 60;
const CONNECT_TIMEOUT_MS = 10_000;
const PROTOCOL_VERSION = 5;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_JITTER_RATIO = 0.5;

function topicMatches(pattern: string, topic: string): boolean {
  const patternSegments = pattern.split('/');
  const topicSegments = topic.split('/');
  const hasMultiWildcard = patternSegments.at(-1) === '#';
  if (!hasMultiWildcard && patternSegments.length !== topicSegments.length) {
    return false;
  }
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    if (patternSegment === '#') {
      return true;
    }
    const topicSegment = topicSegments[index];
    if (topicSegment === undefined) {
      return false;
    }
    if (patternSegment !== '+' && patternSegment !== topicSegment) {
      return false;
    }
  }
  return true;
}

function backoffDelayMs(attempt: number): number {
  const capped = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
  );
  const floor = capped * (1 - RECONNECT_JITTER_RATIO);
  return Math.round(floor + Math.random() * (capped - floor));
}


@Injectable()
export class MqttService implements OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private readonly subscriptions: MqttSubscription[] = [];
  private readonly url: string;
  private readonly clientId: string;
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private client: MqttClient | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private stopped = false;

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get('MQTT_URL', { infer: true });
    this.clientId = config.get('MQTT_CLIENT_ID', { infer: true });
    this.username = config.get('MQTT_USERNAME', { infer: true });
    this.password = config.get('MQTT_PASSWORD', { infer: true });
  }

  register(subscription: MqttSubscription): void {
    this.subscriptions.push(subscription);
    this.ensureClient();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if(this.retryTimer !== undefined) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
    }

    const client = this.client;
    this.client = undefined;
    if(client === undefined) {
        return ;
    }

    try {
        await client.endAsync();
    } catch (error) {
        this.logger.warn(`mqtt disconnect failed: ${String(error)}`);
    }


      
  }

  private ensureClient(): void {
    if (this.client !== undefined || this.stopped) {
      return;
    }
    const client = connect(this.url, {
      clientId: this.clientId,
      username: this.username,
      password: this.password,
      protocolVersion: PROTOCOL_VERSION,
      clean: true,
      keepalive: KEEPALIVE_SECONDS,
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectPeriod: 0,
      resubscribe: false,
    });
    client.on('connect', () => {
      this.reconnectAttempt = 0;
      this.logger.log(`mqtt connected to ${this.url}`);
      void this.subscribeAll();
    });
    client.on('message', (topic, payload) => {
      this.dispatch({ topic, payload });
    });
    client.on('error', (error) => {
      this.logger.warn(`mqtt error: ${error.message}`);
    });
    client.on('close', () => {
      this.handleClose();
    });
    this.client = client;
  }

  private async subscribeAll(): Promise<void> {
    const client = this.client;
    if (client === undefined) {
      return;
    }
    for (const subscription of this.subscriptions) {
      try {
        const granted = await client.subscribeAsync([...subscription.topics], {
          qos: SUBSCRIPTION_QOS,
        });
        this.logger.debug(
          `mqtt subscribed: ${granted.map((grant) => grant.topic).join(', ')}`,
        );
      } catch (error) {
        this.logger.warn(`mqtt subscribe failed: ${String(error)}`);
      }
    }
  }

  private dispatch(message: MqttMessage): void {
    for (const subscription of this.subscriptions) {
      const matched = subscription.topics.some((pattern) =>
        topicMatches(pattern, message.topic),
      );
      if (!matched) {
        continue;
      }
      void subscription.handler(message).catch((error: unknown) => {
        this.logger.error(
          `mqtt handler failed on ${message.topic}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    }
  }

  private handleClose(): void {
    if (
      this.stopped ||
      this.client === undefined ||
      this.retryTimer !== undefined
    ) {
      return;
    }
    this.reconnectAttempt += 1;
    const delay = backoffDelayMs(this.reconnectAttempt);
    this.logger.warn(
      `mqtt disconnected; retry in ${delay} ms (attempt ${this.reconnectAttempt})`,
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.client?.reconnect();
    }, delay);
  }
}
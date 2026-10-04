import { Injectable, Logger } from '@nestjs/common';
import type { ServerEvent } from '@sera/contracts';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type ServerEventDraft = DistributiveOmit<
  ServerEvent,
  'schema_version' | 'ts'
>;

export type ServerEventListener = (event: ServerEventDraft) => void;

@Injectable()
export class DomainEventBus{
    private readonly logger = new Logger(DomainEventBus.name);
    private  readonly listeners =  new Set<ServerEventListener>();

    get listenersCount(): number {
        return this.listeners.size;
    }

    subscribe(listener: ServerEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    publish(event: ServerEventDraft): void {
        for(const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                this.logger.error(
                  error instanceof Error ? error.stack : undefined,
                );
            }
        }
    }
}
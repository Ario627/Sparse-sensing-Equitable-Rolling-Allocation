import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditContext } from '../common/audit/audit-context.ts';
import { EVENT_MESSAGES } from './events.constants.ts';
import { EventsRepository } from './events.repository.ts';
import type {
  EventListPage,
  EventListQuery,
  EventRecord,
  EventStats,
} from './events.types.ts';

@Injectable()
export class EventsService {
  constructor(private readonly repository: EventsRepository) {}

  list(query: EventListQuery): Promise<EventListPage> {
    return this.repository.listEvents(query);
  }

  stats(): Promise<EventStats> {
    return this.repository.loadStats();
  }

  async getById(id: string): Promise<EventRecord> {
    const event = await this.repository.findEventById(id);
    if (event === null) {
      throw new NotFoundException(EVENT_MESSAGES.notFound);
    }
    return event;
  }

  async acknowledge(
    actorId: string,
    eventId: string,
    audit: AuditContext,
  ): Promise<EventRecord> {
    const outcome = await this.repository.acknowledgeAlert(
      eventId,
      actorId,
      audit,
      new Date(),
    );
    if (outcome === 'missing') {
      throw new NotFoundException(EVENT_MESSAGES.notFound);
    }
    if (outcome === 'not_alert') {
      throw new ConflictException(EVENT_MESSAGES.notAlert);
    }
    return this.getById(eventId);
  }
}

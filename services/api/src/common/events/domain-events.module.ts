import { Global, Module } from '@nestjs/common';
import { DomainEventBus } from './domain-event-bus.service.ts';

@Global()
@Module({
  providers: [DomainEventBus],
  exports: [DomainEventBus],
})
export class DomainEventsModule {}

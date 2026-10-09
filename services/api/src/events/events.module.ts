import { Module } from '@nestjs/common';
import { EventsController } from './events.controller.ts';
import { EventsRepository } from './events.repository.ts';
import { EventsService } from './events.service.ts';

@Module({
  controllers: [EventsController],
  providers: [EventsRepository, EventsService],
  exports: [EventsService],
})
export class EventsModule {}

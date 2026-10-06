import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module.ts';
import { CommandAckService } from './commands.ack.service.ts';
import { CommandRetryService } from './commands.retry.service.ts';

@Module({
  imports: [MqttModule],
  providers: [CommandAckService, CommandRetryService],
})
export class CommandsModule {}

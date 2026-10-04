import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module.ts';
import { TelemetryService } from './telemntry.service.ts';

@Module({
  imports: [MqttModule],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}

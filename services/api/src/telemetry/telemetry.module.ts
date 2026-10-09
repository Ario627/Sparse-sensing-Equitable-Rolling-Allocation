import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module.ts';
import { TelemetryController } from './telemetry.controller.ts';
import { TelemetryReadService } from './telemetry-read.service.ts';
import { TelemetryService } from './telemntry.service.ts';
@Module({
  imports: [MqttModule],
  controllers: [TelemetryController],
  providers: [TelemetryService, TelemetryReadService],
  exports: [TelemetryService],
})
export class TelemetryModule {}

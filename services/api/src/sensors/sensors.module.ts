import { Module } from '@nestjs/common';
import { SensorsController } from './sensors.controller.ts';
import { SensorsRepository } from './sensors.repository.ts';
import { SensorsService } from './sensors.service.ts';

@Module({
  controllers: [SensorsController],
  providers: [SensorsRepository, SensorsService],
  exports: [SensorsService],
})
export class SensorsModule {}

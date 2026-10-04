import { Module } from '@nestjs/common';
import { NetworkService } from './networks.service.ts';
import { NetworksController } from './networks.controller.ts';

@Module({
  controllers: [NetworksController],
  providers: [NetworkService],
  exports: [NetworkService],
})
export class NetworksModule {}

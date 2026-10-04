import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.ts';
import { RealtimeGateway } from './realtime.gateway.ts';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}

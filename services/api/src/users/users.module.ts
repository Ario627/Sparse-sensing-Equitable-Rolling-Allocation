import { Module } from '@nestjs/common';
import { P3aController } from './p3a.controller.ts';
import { P3aService } from './p3a.service.ts';
import { UsersController } from './users.controller.ts';
import { UsersMembershipsController } from './users.memberships.controller.ts';
import { UsersMembershipsService } from './users.memberships.service.ts';
import { UsersService } from './users.service.ts';

@Module({
  controllers: [UsersController, P3aController, UsersMembershipsController],
  providers: [UsersService, P3aService, UsersMembershipsService],
  exports: [UsersService],
})
export class UsersModule {}

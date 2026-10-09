import { Module } from '@nestjs/common';
import { P3aController } from './p3a.controller.ts';
import { P3aService } from './p3a.service.ts';
import { UsersController } from './users.controller.ts';
import { UsersMembershipsController } from './users.memberships.controller.ts';
import { UsersMembershipsService } from './users.memberships.service.ts';
import { UsersService } from './users.service.ts';
import { Argon2PasswordService } from './users.password.service.ts';
import { UsersPasswordController } from './users.password.controller.ts';
import { UserCreateService } from './users.create.service.ts';


@Module({
  controllers: [
    UsersController,
    P3aController,
    UsersMembershipsController,
    UsersPasswordController,
  ],
  providers: [
    UsersService,
    P3aService,
    UsersMembershipsService,
    UserCreateService,
    Argon2PasswordService,
  ],
  exports: [
    UsersService,
    Argon2PasswordService,
  ],
})
export class UsersModule {}

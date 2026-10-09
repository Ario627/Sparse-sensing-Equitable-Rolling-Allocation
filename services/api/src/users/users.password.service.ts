import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { HASH_OPTIONS } from './users.constant.ts';

@Injectable()
export class Argon2PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, HASH_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  needsRehash(passwordHash: string): boolean {
    return argon2.needsRehash(passwordHash, HASH_OPTIONS);
  }
}

import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@2play/shared';

const generateRoomCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

export function createId(): string {
  return crypto.randomUUID();
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function createRoomCode(): string {
  return generateRoomCode();
}

export function randomSeed(): number {
  return crypto.randomInt(0, 0xffffffff);
}

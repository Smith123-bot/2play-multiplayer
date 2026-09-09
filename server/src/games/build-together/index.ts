import { BUILD_TOGETHER_METADATA } from '@2play/shared';
import { createCoopGame } from '../coopGameFactory';
export const buildTogetherGame = createCoopGame(BUILD_TOGETHER_METADATA, 'build');

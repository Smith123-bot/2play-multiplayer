import { LOVE_MAZE_METADATA } from '@2play/shared';
import { createCoopGame } from '../coopGameFactory';
export const loveMazeGame = createCoopGame(LOVE_MAZE_METADATA, 'maze');

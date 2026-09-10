import { createClassicGame } from '../classicGamesFactory';
import { CONNECT_FOUR_METADATA } from '@2play/shared';
export const connectFourGame = createClassicGame(CONNECT_FOUR_METADATA, 'connect-four');

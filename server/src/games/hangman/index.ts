import { createClassicGame } from '../classicGamesFactory';
import { HANGMAN_METADATA } from '@2play/shared';
export const hangmanGame = createClassicGame(HANGMAN_METADATA, 'hangman');

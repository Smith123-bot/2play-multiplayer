/**
 * Integration tests boot real servers, so the ephemeral port must be selected
 * before any server module (and its env parsing) is imported.
 */
process.env.PORT = '0';
process.env.NODE_ENV = 'test';
if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'error';

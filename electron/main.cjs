/**
 * SentinelX AI — Universal Desktop Application Entry
 * Automatically detects whether running as User or Admin app based on executable/flags.
 */
const { runSentinelXApp, detectAppMode } = require('./main-core.cjs');

const mode = detectAppMode();
runSentinelXApp(mode);

/**
 * T-11.1.4: Connect WebSocket event emission to BullMQ job lifecycle.
 * These functions are called from job processors after state changes.
 */
import {
  emitFindingNew,
  emitFindingResolved,
  emitScanStarted,
  emitScanCompleted,
  emitAgentConnected,
  emitAgentDisconnected,
  emitCertExpiring,
} from './server.js';

export { emitFindingNew, emitFindingResolved, emitScanStarted, emitScanCompleted, emitAgentConnected, emitAgentDisconnected, emitCertExpiring };

'use strict';

function shouldAutoRestartInstance(inst, batchState = {}) {
  if (!inst) return false;
  if (inst.userStopped) return false;
  if (inst.restarting) return false;
  if (batchState.stopping || batchState.wasStopping || batchState.finished) return false;
  return true;
}

module.exports = { shouldAutoRestartInstance };

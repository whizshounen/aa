'use strict';

function isCrashError(err) {
  const msg = String((err && err.message) || err || '');
  return /target closed|page crashed|session closed|state-lost|browser has been closed|context closed|frame was detached/i.test(msg);
}

async function runPersistentRuns({
  runs = 1,
  launchContext,
  runOne,
  onResult = () => {},
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  betweenRunsMs = 3000,
  recoveryDelayMs = 2000,
  maxConsecutiveCrashes = 3,
} = {}) {
  if (typeof launchContext !== 'function') throw new TypeError('launchContext must be a function');
  if (typeof runOne !== 'function') throw new TypeError('runOne must be a function');

  const totalRuns = Math.max(1, Number(runs) || 1);
  const completed = [];
  let context = null;
  let page = null;
  let consecutiveCrashes = 0;

  const ensurePage = async () => {
    const pageDead = !page || (typeof page.isClosed === 'function' && page.isClosed());
    if (!context || pageDead) {
      if (context && typeof context.close === 'function') {
        try { await context.close(); } catch {}
      }
      context = await launchContext();
      const pages = typeof context.pages === 'function' ? context.pages() : [];
      page = pages[0] || (typeof context.newPage === 'function' ? await context.newPage() : null);
      if (!page) throw new Error('launchContext returned a context with no usable page');
    }
    return page;
  };

  try {
    let runIndex = 0;
    while (runIndex < totalRuns) {
      let currentPage;
      try {
        currentPage = await ensurePage();
      } catch (err) {
        consecutiveCrashes++;
        if (consecutiveCrashes >= maxConsecutiveCrashes) throw err;
        if (recoveryDelayMs > 0) await sleep(recoveryDelayMs);
        continue;
      }

      let crashedDuringRun = false;
      const onCrash = () => { crashedDuringRun = true; };
      if (typeof currentPage.on === 'function') currentPage.on('crash', onCrash);

      try {
        const result = await runOne(currentPage, runIndex + 1);
        consecutiveCrashes = 0;
        completed.push(result);
        onResult(result);
        runIndex++;

        if (crashedDuringRun || (typeof currentPage.isClosed === 'function' && currentPage.isClosed())) {
          if (context && typeof context.close === 'function') {
            try { await context.close(); } catch {}
          }
          context = null;
          page = null;
        }
        if (runIndex < totalRuns && betweenRunsMs > 0) await sleep(betweenRunsMs);
      } catch (err) {
        const closedOrCrash = crashedDuringRun
          || (typeof currentPage.isClosed === 'function' && currentPage.isClosed())
          || isCrashError(err);

        if (context && typeof context.close === 'function') {
          try { await context.close(); } catch {}
        }
        context = null;
        page = null;

        if (!closedOrCrash) throw err;
        consecutiveCrashes++;
        if (consecutiveCrashes >= maxConsecutiveCrashes) {
          throw new Error(`persistent runner aborted after ${consecutiveCrashes} consecutive crashes: ${err && err.message ? err.message : err}`);
        }
        if (recoveryDelayMs > 0) await sleep(recoveryDelayMs);
      }
    }
  } finally {
    if (context && typeof context.close === 'function') {
      try { await context.close(); } catch {}
    }
  }

  return completed;
}

module.exports = { runPersistentRuns, isCrashError };

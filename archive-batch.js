'use strict';

async function archiveBatch(threadIds, archive, concurrency = 4) {
  const archived = [];
  const failed = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, threadIds.length) }, async () => {
    while (next < threadIds.length) {
      const id = threadIds[next++];
      try {
        await archive(id);
        archived.push(id);
      } catch (error) {
        failed.push({ id, message: error.message || 'Archive failed' });
      }
    }
  }));
  return { archived, failed };
}

module.exports = { archiveBatch };

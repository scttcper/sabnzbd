import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import { Sabnzbd, UsenetPostProcess, UsenetPriority } from '../src/index.js';
import type {
  SabAddResponse,
  SabAuthResponse,
  SabFilesResponse,
  SabFullStatus,
  SabHistory,
  SabQueue,
  SabServerStats,
  SabWarning,
} from '../src/types.js';

const defaultConfigPath = '/tmp/sabnzbd-local-test/sabnzbd.ini';

function readDefaultApiKey(configPath: string): string | undefined {
  if (!existsSync(configPath)) {
    return undefined;
  }

  const config = readFileSync(configPath, 'utf8');
  const match = config.match(/^api_key = (.+)$/m);
  return match?.[1]?.trim() || undefined;
}

const baseUrl = process.env.TEST_SABNZBD_URL ?? 'http://127.0.0.1:8080';
const apiKey = process.env.TEST_SABNZBD_API_KEY ?? readDefaultApiKey(defaultConfigPath);
const sampleUrl = process.env.TEST_SABNZBD_NZB_URL;
const integrationEnabled = Boolean(apiKey);
const __dirname = new URL('.', import.meta.url).pathname;
const fixturePath = path.join(__dirname, 'fixtures', 'sample.nzb');
const sampleNzb = readFileSync(fixturePath);

async function sleep(milliseconds: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForQueueJob(
  client: Sabnzbd,
  id: string,
  attempts = 20,
): Promise<Awaited<ReturnType<Sabnzbd['getQueueJob']>>> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await client.getQueueJob(id);
    } catch {
      if (attempt === attempts - 1) {
        throw new Error(`Queue job ${id} did not become available`);
      }

      await sleep(250);
    }
  }

  throw new Error(`Queue job ${id} did not become available`);
}

async function waitForMissingJob(client: Sabnzbd, id: string, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await client.findJob(id)) === null) {
      return;
    }

    if (attempt < attempts - 1) {
      await sleep(250);
    }
  }

  throw new Error(`Job ${id} was still visible after removal`);
}

function getAddedId(response: SabAddResponse): string {
  const id = response.nzo_ids[0];
  if (!id) {
    throw new Error('Expected SAB add response to include an id');
  }

  return id;
}

async function createPausedJob(client: Sabnzbd, name: string): Promise<string> {
  return client.addNzbFile(sampleNzb, {
    category: '*',
    startPaused: true,
    name,
  });
}

describe.skipIf(!integrationEnabled)('sabnzbd integration', () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  function addCleanup(cleanup: () => Promise<void> | void): void {
    cleanups = [cleanup, ...cleanups];
  }

  afterEach(async () => {
    const failures: unknown[] = [];

    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }

    cleanups = [];

    if (failures.length === 1) {
      throw failures[0];
    }

    if (failures.length > 1) {
      throw new AggregateError(failures, 'Multiple cleanup steps failed');
    }
  });

  it('loads auth payload shape', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const auth = await client.auth();

    expectTypeOf(auth).toEqualTypeOf<SabAuthResponse>();
    expect(auth).toMatchObject({
      auth: expect.any(String),
    });
  });

  it('loads version payload shape', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const version = await client.getVersion();

    expect(version).toMatch(/^\d+\.\d+/);
  });

  it('loads full status payload shape', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const fullStatus = await client.getFullStatus();

    expectTypeOf(fullStatus).toEqualTypeOf<SabFullStatus>();
    expect(fullStatus).toEqual(expect.any(Object));
  });

  it('loads warnings payload shape', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const warnings = await client.getWarnings();

    expectTypeOf(warnings).toEqualTypeOf<SabWarning[]>();
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('loads server stats payload shape', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const serverStats = await client.getServerStats();

    expectTypeOf(serverStats).toEqualTypeOf<SabServerStats>();
    expect(serverStats).toMatchObject({
      day: expect.any(Number),
      week: expect.any(Number),
      month: expect.any(Number),
      total: expect.any(Number),
      servers: expect.any(Object),
    });
  });

  it('loads raw queue payload shape', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const queue = await client.listQueue({ limit: 5 });

    expectTypeOf(queue).toEqualTypeOf<SabQueue>();
    expect(Array.isArray(queue.slots)).toBe(true);
  });

  it('loads raw history payload shape', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const history = await client.listHistory({ limit: 5, status: ['Completed', 'Failed'] });

    expectTypeOf(history).toEqualTypeOf<SabHistory>();
    expect(Array.isArray(history.slots)).toBe(true);
  });

  it('loads categories payload shape', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const categories = await client.getCategories();

    expect(Array.isArray(categories)).toBe(true);
  });

  it('loads scripts payload shape', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const scripts = await client.getScripts();

    expect(Array.isArray(scripts)).toBe(true);
  });

  it('loads normalized all-data state', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const data = await client.getAllData();

    expect(Array.isArray(data.queue)).toBe(true);
    expect(Array.isArray(data.history)).toBe(true);
  });

  it('loads normalized queue items', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const queue = await client.getQueue();

    expect(Array.isArray(queue)).toBe(true);
  });

  it('loads normalized history items', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const history = await client.getHistory();

    expect(Array.isArray(history)).toBe(true);
  });

  it('loads one normalized queue item by id', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'queue-job-by-id');
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    await expect(client.getQueueJob(id)).resolves.toMatchObject({
      id,
      name: expect.any(String),
      category: expect.any(String),
      progress: expect.any(Number),
      isCompleted: expect.any(Boolean),
      stateMessage: expect.any(String),
      totalSize: expect.any(Number),
      remainingSize: expect.any(Number),
      raw: expect.any(Object),
    });
  });

  it('throws for a missing normalized history item id', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = 'SABnzbd_nzo_missing_history';

    await expect(client.getHistoryJob(id)).rejects.toMatchObject({
      name: 'UsenetNotFoundError',
      code: 'USENET_NOT_FOUND',
      client: 'sabnzbd',
      target: 'historyJob',
      id,
    });
  });

  it('finds queue jobs by id', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'find-job');
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    await expect(client.findJob(id)).resolves.toMatchObject({
      source: 'queue',
      job: {
        id,
        raw: expect.any(Object),
      },
    });
  });

  it('returns null after removing a queue job', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'find-job-removed');

    await client.removeJob(id, true);
    await waitForMissingJob(client, id);

    await expect(client.findJob(id)).resolves.toBeNull();
  });

  it('returns null for a missing normalized job lookup', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });

    await expect(client.findJob('SABnzbd_nzo_missing')).resolves.toBeNull();
  });

  it('pauses queue downloads', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    addCleanup(async () => {
      await client.resumeQueue();
    });

    await expect(client.resumeQueue()).resolves.toBe(true);
    await expect(client.pauseQueue()).resolves.toBe(true);
    await expect(client.listQueue()).resolves.toMatchObject({ paused: true });
  });

  it('resumes queue downloads', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    addCleanup(async () => {
      await client.resumeQueue();
    });

    await expect(client.pauseQueue()).resolves.toBe(true);
    await expect(client.resumeQueue()).resolves.toBe(true);
    await expect(client.listQueue()).resolves.toMatchObject({ paused: false });
  });

  it('pauses and resumes post processing', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    addCleanup(async () => {
      await client.resumePostProcessing();
    });

    await expect(client.pausePostProcessing()).resolves.toBe(true);
    await expect(client.resumePostProcessing()).resolves.toBe(true);
  });

  it('runs rss_now', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });

    await expect(client.fetchRss()).resolves.toBe(true);
  });

  it('runs watched_now', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });

    await expect(client.scanWatchedFolder()).resolves.toBe(true);
  });

  it('runs reset_quota', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });

    await expect(client.resetQuota()).resolves.toBe(true);
  });

  it('runs warnings clear', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });

    await expect(client.clearWarnings()).resolves.toBe(true);
  });

  it('adds a file and reads files payload', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const response = await client.addFile(sampleNzb, {
      category: '*',
      priority: -2,
      name: 'raw-file.nzb',
    });
    const id = getAddedId(response);
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    const files = await client.getFiles(id);
    expectTypeOf(files).toEqualTypeOf<SabFilesResponse>();
    expect(files).toMatchObject({
      files: expect.any(Array),
    });
  });

  it('changes category on a queue job', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'change-category');
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    await expect(client.changeCategory(id, '*')).resolves.toBe(true);
  });

  it('changes priority on a queue job', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'change-priority');
    const originalPriority = (await client.getQueueJob(id)).priority ?? UsenetPriority.default;
    addCleanup(async () => {
      await client.setPriority(id, originalPriority);
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    const position = await client.changePriority(id, UsenetPriority.high);
    expect(['number', 'undefined']).toContain(typeof position);
  });

  it('changes post process on a queue job', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'change-post-process');
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    await expect(client.changePostProcess(id, UsenetPostProcess.repairUnpack)).resolves.toBe(true);
  });

  it('pauses and resumes an individual queue job', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'pause-resume-job');
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    await expect(client.pauseJob(id)).resolves.toBe(true);
    await expect(client.resumeJob(id)).resolves.toBe(true);
  });

  it('moves a queue job when two jobs exist', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const firstId = await createPausedJob(client, 'move-job-first');
    const secondId = await createPausedJob(client, 'move-job-second');
    addCleanup(async () => {
      await client.deleteJob(firstId, true);
      await client.deleteJob(secondId, true);
      await waitForMissingJob(client, firstId);
      await waitForMissingJob(client, secondId);
    });

    await waitForQueueJob(client, firstId);
    await waitForQueueJob(client, secondId);
    await expect(client.moveJob(secondId, 0)).resolves.toBe(true);
  });

  it('sets category via wrapper', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'set-category-wrapper');
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    await expect(client.setCategory(id, '*')).resolves.toBe(true);
  });

  it('sets priority via wrapper', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'set-priority-wrapper');
    const originalPriority = (await client.getQueueJob(id)).priority ?? UsenetPriority.default;
    addCleanup(async () => {
      await client.setPriority(id, originalPriority);
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    await expect(client.setPriority(id, UsenetPriority.high)).resolves.toBe(true);
  });

  it('sets speed limit', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });

    await expect(client.setSpeedLimit(0)).resolves.toBe(true);
  });

  it('rejects rename on current SAB image', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'rename-failure');
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    await expect(client.renameJob(id, 'typedoc.integration.rename')).rejects.toThrow(
      /not implemented/i,
    );
  });

  it.skipIf(!sampleUrl)('adds a url via raw add endpoint', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const response = await client.addUrl(sampleUrl!, {
      category: '*',
      priority: -2,
      name: 'raw-url',
    });
    const id = getAddedId(response);
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    expect(id).toEqual(expect.any(String));
  });

  it.skipIf(!sampleUrl)('adds a url via normalized addNzbUrl endpoint', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await client.addNzbUrl(sampleUrl!, {
      category: '*',
      startPaused: true,
      name: 'normalized-url',
    });
    addCleanup(async () => {
      await client.deleteJob(id, true);
      await waitForMissingJob(client, id);
    });

    expect(id).toEqual(expect.any(String));
  });

  it.skipIf(!sampleUrl)('adds a url via normalizedAddNzb helper', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const job = await client.normalizedAddNzb(
      { url: sampleUrl! },
      { category: '*', startPaused: true },
    );
    addCleanup(async () => {
      await client.deleteJob(job.id, true);
      await waitForMissingJob(client, job.id);
    });

    expect(job).toMatchObject({
      id: expect.any(String),
      raw: expect.any(Object),
    });
  });

  it('removes a queue job via removeJob wrapper', async () => {
    const client = new Sabnzbd({ baseUrl, apiKey });
    const id = await createPausedJob(client, 'remove-wrapper');

    await expect(client.removeJob(id, true)).resolves.toBe(true);
    await waitForMissingJob(client, id);
  });
});

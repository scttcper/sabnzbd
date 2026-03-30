import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { LiteralUnion } from 'type-fest';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  Sabnzbd,
  normalizeSabHistoryItem,
  normalizeSabJob,
  normalizeSabStatus,
} from '../src/index.js';
import type {
  SabFileStatus,
  SabFullStatus,
  SabHistoryPostProcessValue,
  SabHistoryStatusFilter,
  SabHistory,
  SabHistoryQuery,
  SabPostProcessValue,
  SabPriorityValue,
  SabQueue,
  SabQueueQuery,
  SabQueueStatusFilter,
  SabRawPostProcessValue,
  SabRawPriorityValue,
  SabRawStatus,
  SabServerStats,
  SabStatus,
  SabWarningType,
} from '../src/types.js';

const __dirname = new URL('.', import.meta.url).pathname;

function readFixture<T>(filename: string): T {
  const filePath = path.join(__dirname, 'fixtures', filename);
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

describe('normalizeSabJob', () => {
  it('normalizes queue items', () => {
    const queue = readFixture<{ queue: SabQueue }>('queue.json').queue;
    const job = normalizeSabJob(queue.slots[0]!);

    expect(job.id).toBe('SABnzbd_nzo_123');
    expect(job.category).toBe('movies');
    expect(job.progress).toBe(50);
    expect(job.stateMessage).toBe('Downloading');
    expect(job.postProcessScript).toBe('Notify.py');
    expect(job.totalSize).toBeGreaterThan(job.remainingSize);
  });
});

describe('normalizeSabHistoryItem', () => {
  it('normalizes completed and failed history', () => {
    const history = readFixture<{ history: SabHistory }>('history.json').history;
    const [completed, failed] = history.slots.map(normalizeSabHistoryItem);

    expect(completed?.succeeded).toBe(true);
    expect(completed?.progress).toBe(100);
    expect(completed?.stateMessage).toBe('Completed');
    expect(failed?.succeeded).toBe(false);
    expect(failed?.stateMessage).toBe('Failed');
    expect(failed?.failureMessage).toContain('Missing');
  });
});

describe('normalizeSabStatus', () => {
  it('normalizes queue summary and full status', () => {
    const queue = readFixture<{ queue: SabQueue }>('queue.json').queue;
    const fullStatus = readFixture<SabFullStatus>('fullstatus.json');
    const status = normalizeSabStatus(queue, fullStatus);

    expect(status.isDownloadPaused).toBe(false);
    expect(status.speedBytesPerSecond).toBe(1024 * 1024);
    expect(status.completeDir).toBe('/downloads/complete');
  });
});

describe('lookup helpers', () => {
  it('types documented warning stats and query payloads', () => {
    expectTypeOf<SabStatus>().toEqualTypeOf<
      | 'Grabbing'
      | 'Queued'
      | 'Paused'
      | 'Checking'
      | 'Downloading'
      | 'QuickCheck'
      | 'Verifying'
      | 'Repairing'
      | 'Fetching'
      | 'Extracting'
      | 'Moving'
      | 'Running'
      | 'Completed'
      | 'Failed'
      | 'Deleted'
      | 'Propagating'
    >();
    expectTypeOf<SabRawStatus>().toEqualTypeOf<LiteralUnion<SabStatus, string>>();
    expectTypeOf<SabWarningType>().toEqualTypeOf<LiteralUnion<'WARNING' | 'ERROR', string>>();
    expectTypeOf<SabPriorityValue>().toEqualTypeOf<-100 | -4 | -3 | -2 | -1 | 0 | 1 | 2>();
    expectTypeOf<SabRawPriorityValue>().toEqualTypeOf<SabPriorityValue | `${SabPriorityValue}`>();
    expectTypeOf<SabPostProcessValue>().toEqualTypeOf<-1 | 0 | 1 | 2 | 3>();
    expectTypeOf<SabRawPostProcessValue>().toEqualTypeOf<
      SabPostProcessValue | `${SabPostProcessValue}`
    >();
    expectTypeOf<SabHistoryPostProcessValue>().toEqualTypeOf<'R' | 'U' | 'D'>();
    expectTypeOf<SabFileStatus>().toEqualTypeOf<
      LiteralUnion<'finished' | 'active' | 'queued', string>
    >();
    expectTypeOf<SabQueueQuery['status']>().toEqualTypeOf<
      SabQueueStatusFilter | SabQueueStatusFilter[] | undefined
    >();
    expectTypeOf<SabQueueQuery['priority']>().toEqualTypeOf<
      SabPriorityValue | SabPriorityValue[] | undefined
    >();
    expectTypeOf<SabHistoryQuery['status']>().toEqualTypeOf<
      SabHistoryStatusFilter | SabHistoryStatusFilter[] | undefined
    >();
    expectTypeOf<SabHistoryQuery['lastHistoryUpdate']>().toEqualTypeOf<
      number | string | undefined
    >();
    expectTypeOf<SabFullStatus['servers']>().toEqualTypeOf<
      | Array<{
          servername: string;
          servertotalconn: number;
          serverssl: number;
          serveractiveconn: number;
          serveroptional: number;
          serveractive: boolean;
          servererror: string;
          serverpriority: number;
          serverbps: string;
          serverconnections: Array<{
            thrdnum: number;
            nzo_name?: string;
            nzf_name?: string;
            art_name?: string;
          }>;
        }>
      | undefined
    >();
    expectTypeOf<SabServerStats['servers']>().toEqualTypeOf<
      Record<
        string,
        {
          day: number;
          week: number;
          month: number;
          total: number;
          daily: Record<string, number>;
          articles_tried: number;
          articles_success: number;
        }
      >
    >();
  });

  it('finds queue and history jobs explicitly', async () => {
    const client = new Sabnzbd();
    const queue = readFixture<{ queue: SabQueue }>('queue.json').queue;
    const history = readFixture<{ history: SabHistory }>('history.json').history;

    client.listQueue = async () => queue;
    client.listHistory = async () => history;

    const queueJob = await client.getQueueJob('SABnzbd_nzo_123');
    expect(queueJob.name).toBe('movie.release');

    const historyJob = await client.getHistoryJob('SABnzbd_nzo_done');
    expect(historyJob.name).toBe('completed.release');

    const foundQueue = await client.findJob('SABnzbd_nzo_123');
    expect(foundQueue?.source).toBe('queue');

    const foundHistory = await client.findJob('SABnzbd_nzo_done');
    expect(foundHistory?.source).toBe('history');

    await expect(client.getQueueJob('missing')).rejects.toMatchObject({
      name: 'UsenetNotFoundError',
      code: 'USENET_NOT_FOUND',
      client: 'sabnzbd',
      target: 'queueJob',
      id: 'missing',
    });

    await expect(client.getHistoryJob('missing')).rejects.toMatchObject({
      name: 'UsenetNotFoundError',
      code: 'USENET_NOT_FOUND',
      client: 'sabnzbd',
      target: 'historyJob',
      id: 'missing',
    });

    const missing = await client.findJob('missing');
    expect(missing).toBeNull();
  });

  it('maps unknown raw SAB statuses to the normalized unknown state', () => {
    const queue = readFixture<{ queue: SabQueue }>('queue.json').queue;
    const job = normalizeSabJob({
      ...queue.slots[0]!,
      status: 'FutureStatus',
    });

    expect(job.state).toBe('unknown');
    expect(job.stateMessage).toBe('Unknown');
  });

  it('returns a normalized queue id from add helpers', async () => {
    const client = new Sabnzbd();

    client.addFile = async () => ({
      status: true,
      nzo_ids: ['SABnzbd_nzo_added'],
    });
    client.addUrl = async () => ({
      status: true,
      nzo_ids: ['SABnzbd_nzo_added_url'],
    });

    await expect(client.addNzbFile('<nzb />')).resolves.toBe('SABnzbd_nzo_added');
    await expect(client.addNzbUrl('https://example.test/test.nzb')).resolves.toBe(
      'SABnzbd_nzo_added_url',
    );
  });

  it('maps numeric SAB priority values explicitly for add helpers', async () => {
    const client = new Sabnzbd();
    let seenPriority: number | undefined;

    client.addUrl = async (_url, options) => {
      seenPriority = options?.priority;
      return {
        status: true,
        nzo_ids: ['SABnzbd_nzo_added_url'],
      };
    };

    // @ts-expect-error Runtime validation for untyped callers.
    await client.addNzbUrl('https://example.test/test.nzb', { priority: -100 });
    expect(seenPriority).toBe(-100);
  });

  it('rejects unsupported numeric SAB priority values', async () => {
    const client = new Sabnzbd();

    // @ts-expect-error Runtime validation for untyped callers.
    const call = client.addNzbUrl('https://example.test/test.nzb', { priority: 7 });
    await expect(call).rejects.toThrow('Unsupported SAB priority value: 7');
  });

  it('rejects unsupported numeric SAB post-process values', async () => {
    const client = new Sabnzbd();

    // @ts-expect-error Runtime validation for untyped callers.
    const call = client.addNzbUrl('https://example.test/test.nzb', { postProcess: 9 });
    await expect(call).rejects.toThrow('Unsupported SAB post-process value: 9');
  });

  it('propagates non-not-found errors from normalizedAddNzb lookup', async () => {
    const client = new Sabnzbd();

    client.addNzbUrl = async () => 'SABnzbd_nzo_added_url';
    client.getQueueJob = async () => {
      throw new Error('queue lookup failed');
    };

    await expect(client.normalizedAddNzb({ url: 'https://example.test/test.nzb' })).rejects.toThrow(
      'queue lookup failed',
    );
  });
});

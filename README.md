# SABnzbd

> TypeScript api wrapper for [SABnzbd](https://sabnzbd.org/) using [ofetch](https://github.com/unjs/ofetch)

### Overview

Includes the normalized usenet API shared through [@ctrl/shared-usenet](https://github.com/scttcper/shared-usenet) and also available in [@ctrl/nzbget](https://github.com/scttcper/nzbget):

- [`getAllData()`](#getalldata)
- [`getQueue()`](#getqueue)
- [`getHistory()`](#gethistory)
- [`getQueueJob(id)`](#getqueuejobid)
- [`getHistoryJob(id)`](#gethistoryjobid)
- [`findJob(id)`](#findjobid)
- [`addNzbFile(...)` / `addNzbUrl(...)`](#addnzbfile--addnzburl)
- [`normalizedAddNzb(...)`](#normalizedaddnzb)
- queue control methods return `boolean`
- `addNzbFile` and `addNzbUrl` return the normalized queue id as a `string`

Use the normalized methods by default. Drop to the native SABnzbd methods only when you need SAB-specific behavior such as script changes, post-process changes, rename operations, or raw queue/history responses.

### Install

```console
npm install @ctrl/sabnzbd
```

### Use

```ts
import { Sabnzbd } from '@ctrl/sabnzbd';

const client = new Sabnzbd({
  baseUrl: 'http://localhost:8080/',
  apiKey: 'api-key',
});

async function main() {
  const data = await client.getAllData();
  console.log(data.queue);
}
```

### Normalized Example

```ts
import { Sabnzbd, UsenetNotFoundError, UsenetPriority } from '@ctrl/sabnzbd';

const client = new Sabnzbd({
  baseUrl: 'http://localhost:8080/',
  apiKey: 'api-key',
});

async function main() {
  const id = await client.addNzbUrl('https://example.test/release.nzb', {
    category: 'movies',
    priority: UsenetPriority.high,
    startPaused: false,
  });

  try {
    const job = await client.getQueueJob(id);
    console.log(job.state, job.progress);
  } catch (error) {
    if (error instanceof UsenetNotFoundError) {
      console.log('job missing', error.id);
    }
  }
}
```

### API

Docs: https://sabnzbd.ep.workers.dev  
SABnzbd API Docs: https://sabnzbd.org/wiki/configuration/4.5/api

### Normalized Methods

##### `getAllData()`

Returns queue, history, categories, scripts, and status in normalized form. This is the broadest normalized read and fits best when you want an overview in one call.

##### `getQueue()`

Returns normalized active queue items.

##### `getHistory()`

Returns normalized history items.

##### `getQueueJob(id)`

Returns one normalized active queue item. Missing ids throw `UsenetNotFoundError`.

##### `getHistoryJob(id)`

Returns one normalized history item. Missing ids throw `UsenetNotFoundError`.

##### `findJob(id)`

Searches queue first, then history, and returns `{ source, job }` or `null`. It is the convenient path when you do not know which side the id should be on.

##### `addNzbFile(...)` / `addNzbUrl(...)`

Add an NZB and return the normalized queue id as a `string`. These are the lighter add helpers when an id is enough.
The normalized add option names are `category`, `priority`, `postProcess`, `postProcessScript`, `name`, `password`, and `startPaused`.

##### `normalizedAddNzb(...)`

Add an NZB from either a URL or file content and return the created normalized queue item. This is the higher-level add helper when you want the normalized job back immediately.

##### Normalized state labels

`stateMessage` uses the shared `UsenetStateMessage` vocabulary:
`Grabbing`, `Queued`, `Downloading`, `Paused`, `Post-processing`, `Completed`, `Failed`, `Warning`, `Deleted`, and `Unknown`.

### Native API

SABnzbd-specific methods are still available when you need the raw client surface.

Connection and discovery:

- `auth()`
- `getVersion()`
- `getFullStatus()`
- `getWarnings()`
- `clearWarnings()`
- `getServerStats()`
- `listQueue(query?)`
- `listHistory(query?)`
- `getCategories()`
- `getScripts()`
- `getFiles(id)`

Queue and job mutation:

- `deleteJob(id, deleteFiles?)`
- `shutdown()`
- `restart()`
- `restartRepair()`
- `pausePostProcessing()`
- `resumePostProcessing()`
- `fetchRss()`
- `scanWatchedFolder()`
- `resetQuota()`
- `changeCategory(id, category)`
- `changeScript(id, script)`
- `changePriority(id, priority)`
- `changePostProcess(id, postProcess)`
- `renameJob(id, name, password?)`
- `setSpeedLimit(limit)`

Raw add methods:

- `addUrl(url, options?)`
- `addFile(nzb, options?)`

##### export and create from state

```ts
const state = client.exportState();
const restored = Sabnzbd.createFromState(config, state);
```

### Local Integration Testing

Use a disposable SABnzbd instance on `localhost:8080` with its config mounted at `/tmp/sabnzbd-local-test`.

```console
docker run -d --name sabnzbd-local-test \
  -p 8080:8080 \
  -v /tmp/sabnzbd-local-test:/config \
  lscr.io/linuxserver/sabnzbd:latest
```

Wait for first-run setup to create `sabnzbd.ini`:

```console
ls -l /tmp/sabnzbd-local-test/sabnzbd.ini
```

Read the generated API key:

```console
docker exec sabnzbd-local-test sed -n 's/^api_key = //p' /config/sabnzbd.ini
```

Run only the integration spec:

```console
TEST_SABNZBD_URL=http://127.0.0.1:8080 \
TEST_SABNZBD_API_KEY=$(docker exec sabnzbd-local-test sed -n 's/^api_key = //p' /config/sabnzbd.ini) \
pnpm test test/integration.spec.ts
```

Run the full test suite:

```console
TEST_SABNZBD_URL=http://127.0.0.1:8080 \
TEST_SABNZBD_API_KEY=$(docker exec sabnzbd-local-test sed -n 's/^api_key = //p' /config/sabnzbd.ini) \
pnpm test
```

The integration spec in [`test/integration.spec.ts`](/Users/scooper/gh/sabnzbd/test/integration.spec.ts) defaults to this exact setup:

- `baseUrl` defaults to `http://127.0.0.1:8080`
- `apiKey` is read from `/tmp/sabnzbd-local-test/sabnzbd.ini` if `TEST_SABNZBD_API_KEY` is unset

### See Also

- shared types - [@ctrl/shared-usenet](https://github.com/scttcper/shared-usenet)
- torrent shared types - [@ctrl/shared-torrent](https://github.com/scttcper/shared-torrent)
- nzbget - [@ctrl/nzbget](https://github.com/scttcper/nzbget)
- deluge - [@ctrl/deluge](https://github.com/scttcper/deluge)
- transmission - [@ctrl/transmission](https://github.com/scttcper/transmission)
- qbittorrent - [@ctrl/qbittorrent](https://github.com/scttcper/qbittorrent)
- utorrent - [@ctrl/utorrent](https://github.com/scttcper/utorrent)
- rtorrent - [@ctrl/rtorrent](https://github.com/scttcper/rtorrent)

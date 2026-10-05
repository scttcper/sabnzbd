import {
  type AddNzbOptions as NormalizedAddNzbOptions,
  type AllClientData,
  type Category,
  type FoundUsenetJob,
  type NormalizedUsenetHistoryItem,
  type NormalizedUsenetJob,
  type NzbInput,
  type Script,
  type UsenetClient,
  type UsenetClientConfig,
  type UsenetClientState,
  UsenetNotFoundError,
  UsenetPriority,
} from '@ctrl/shared-usenet';
import type { Jsonify } from 'type-fest';

import {
  buildAddFileForm,
  getSabAddFields,
  normalizeAddOptions,
  normalizeAddPostProcess,
} from './addOptions.js';
import {
  normalizeSabHistoryItem,
  normalizeSabJob,
  normalizeSabStatus,
  normalizedPriorityToSab,
} from './normalizeUsenetData.js';
import { requestSab, type SabRequestOptions, type SabRequestParams } from './sabTransport.js';
import type {
  SabAddOptions,
  SabAddResponse,
  SabAuthResponse,
  SabCategoriesResponse,
  SabFilesResponse,
  SabFullStatus,
  SabHistory,
  SabHistoryQuery,
  SabPositionResponse,
  SabQueue,
  SabQueueQuery,
  SabQueueSortField,
  SabRemoveResponse,
  SabRetriedJobId,
  SabRetryAllResponse,
  SabRetryResponse,
  SabScriptsResponse,
  SabSortDirection,
  SabServerStats,
  SabVersionResponse,
  SabWarning,
  SabWarningsResponse,
} from './types.js';

interface SabnzbdState extends UsenetClientState {
  auth?: {
    apiKey?: string;
    nzbKey?: string;
  };
  version?: {
    version: string;
  };
}

const defaults: UsenetClientConfig = {
  baseUrl: 'http://localhost:8080/',
  path: '/api',
  username: '',
  password: '',
  timeout: 5000,
};
const addQueuePollAttempts = 40;
const addQueuePollIntervalMs = 250;

function toQueryStringValue(value: boolean | number | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  return `${value}`;
}

function toCommaList(
  value: string | number | Array<string | number> | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value.join(',') : `${value}`;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function getAddedJobId(response: SabAddResponse): string {
  const [id] = response.nzo_ids;
  if (!response.status || !id) {
    throw new Error(response.error ?? 'SABnzbd did not return a queue id');
  }

  return id;
}

/**
 * URL fetch retries return the `add_url` result tuple instead of a plain id.
 */
function getRetriedJobId(value: SabRetriedJobId): string | undefined {
  return typeof value === 'string' ? value : value[1][0];
}

function isUsenetNotFoundError(error: unknown): error is UsenetNotFoundError {
  return error instanceof UsenetNotFoundError;
}

export class Sabnzbd implements UsenetClient {
  static createFromState(
    config: Readonly<UsenetClientConfig>,
    state: Readonly<Jsonify<SabnzbdState>>,
  ): Sabnzbd {
    const client = new Sabnzbd(config);
    client.state = { ...state };
    return client;
  }

  config: UsenetClientConfig;
  state: SabnzbdState = {};

  constructor(options: Partial<UsenetClientConfig> = {}) {
    this.config = { ...defaults, ...options };
  }

  exportState(): Jsonify<SabnzbdState> {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Verifies configured credentials against the SABnzbd API.
   *
   * Calls SABnzbd `mode=auth`.
   *
   * @returns The raw SABnzbd authentication response.
   */
  async auth(): Promise<SabAuthResponse> {
    const response = await this.request<SabAuthResponse>({ mode: 'auth' });
    this.state.auth = {
      apiKey: this.config.apiKey,
      nzbKey: this.config.nzbKey,
    };
    return response;
  }

  /**
   * Reads the SABnzbd version string.
   *
   * Calls SABnzbd `mode=version`.
   *
   * @returns The SABnzbd version.
   */
  async getVersion(): Promise<string> {
    const response = await this.request<SabVersionResponse>({ mode: 'version' });
    this.state.version = { version: response.version };
    return response.version;
  }

  /**
   * Loads full server and queue status details from SABnzbd.
   *
   * Calls SABnzbd `mode=fullstatus` with `skip_dashboard=1`.
   *
   * @returns The full status payload.
   */
  async getFullStatus(): Promise<SabFullStatus> {
    const response = await this.request<{ status: SabFullStatus }>({
      mode: 'fullstatus',
      skip_dashboard: '1',
    });
    return response.status;
  }

  /**
   * Retrieves the current SABnzbd warning list.
   *
   * Calls SABnzbd `mode=warnings`.
   *
   * @returns All active warnings.
   */
  async getWarnings(): Promise<SabWarning[]> {
    const response = await this.request<SabWarningsResponse>({ mode: 'warnings' });
    return response.warnings;
  }

  /**
   * Retrieves per-server traffic totals from SABnzbd.
   *
   * Calls SABnzbd `mode=server_stats`.
   *
   * @returns Aggregate and per-server transfer statistics.
   */
  async getServerStats(): Promise<SabServerStats> {
    return this.request<SabServerStats>({ mode: 'server_stats' });
  }

  /**
   * Lists queue entries, optionally filtered and paged.
   *
   * Calls SABnzbd `mode=queue`.
   *
   * @param query Optional queue filters and pagination controls.
   * @returns The raw queue payload including `slots`.
   */
  async listQueue(query: SabQueueQuery = {}): Promise<SabQueue> {
    const response = await this.request<{ queue: SabQueue }>({
      mode: 'queue',
      start: toQueryStringValue(query.start),
      limit: toQueryStringValue(query.limit),
      search: query.search,
      category: toCommaList(query.category),
      priority: toCommaList(query.priority),
      status: toCommaList(query.status),
      nzo_ids: toCommaList(query.nzoIds),
    });

    return response.queue;
  }

  /**
   * Lists history entries, optionally filtered and paged.
   *
   * Calls SABnzbd `mode=history`.
   *
   * @param query Optional history filters, pagination, and archive controls.
   * @returns The raw history payload including `slots`, or `false` when `lastHistoryUpdate`
   * matches SAB's current `last_history_update` and nothing changed.
   */
  async listHistory(query?: Omit<SabHistoryQuery, 'lastHistoryUpdate'>): Promise<SabHistory>;
  async listHistory(query: SabHistoryQuery): Promise<SabHistory | false>;
  async listHistory(query: SabHistoryQuery = {}): Promise<SabHistory | false> {
    const response = await this.request<{ history: SabHistory | false }>({
      mode: 'history',
      start: toQueryStringValue(query.start),
      limit: toQueryStringValue(query.limit),
      search: query.search,
      category: toCommaList(query.category),
      status: toCommaList(query.status),
      nzo_ids: toCommaList(query.nzoIds),
      failed_only: toQueryStringValue(query.failedOnly),
      archive: toQueryStringValue(query.archived),
      last_history_update: toQueryStringValue(query.lastHistoryUpdate),
    });

    return response.history;
  }

  /**
   * Retrieves configured SABnzbd categories.
   *
   * Calls SABnzbd `mode=get_cats`.
   *
   * @returns Categories normalized to shared `Category` objects.
   */
  async getCategories(): Promise<Category[]> {
    const response = await this.request<SabCategoriesResponse>({ mode: 'get_cats' });
    // `*` is SAB's default category, normalized jobs report it as an empty category
    return response.categories.map(category => ({
      id: category === '*' ? '' : category,
      name: category,
    }));
  }

  /**
   * Retrieves configured SABnzbd post-processing scripts.
   *
   * Calls SABnzbd `mode=get_scripts`.
   *
   * @returns Scripts normalized to shared `Script` objects.
   */
  async getScripts(): Promise<Script[]> {
    const response = await this.request<SabScriptsResponse>({ mode: 'get_scripts' });
    return response.scripts.map(script => ({
      id: script,
      name: script,
    }));
  }

  /**
   * Pauses the global download queue.
   *
   * Calls SABnzbd `mode=pause`.
   *
   * @returns `true` when SABnzbd accepts the pause command.
   */
  async pauseQueue(): Promise<boolean> {
    return this.command({ mode: 'pause' });
  }

  /**
   * Resumes the global download queue.
   *
   * Calls SABnzbd `mode=resume`.
   *
   * @returns `true` when SABnzbd accepts the resume command.
   */
  async resumeQueue(): Promise<boolean> {
    return this.command({ mode: 'resume' });
  }

  /**
   * Requests SABnzbd shutdown.
   *
   * Calls SABnzbd `mode=shutdown`.
   *
   * @returns `true` when SABnzbd accepts the shutdown command.
   */
  async shutdown(): Promise<boolean> {
    return this.command({ mode: 'shutdown' });
  }

  /**
   * Requests a standard SABnzbd restart.
   *
   * Calls SABnzbd `mode=restart`.
   *
   * @returns `true` when SABnzbd accepts the restart command.
   */
  async restart(): Promise<boolean> {
    return this.command({ mode: 'restart' });
  }

  /**
   * Requests SABnzbd restart with queue repair.
   *
   * Calls SABnzbd `mode=restart_repair`.
   *
   * @returns `true` when SABnzbd accepts the repair restart command.
   */
  async restartRepair(): Promise<boolean> {
    return this.command({ mode: 'restart_repair' });
  }

  /**
   * Pauses post-processing tasks.
   *
   * Calls SABnzbd `mode=pause_pp`.
   *
   * @returns `true` when SABnzbd accepts the post-processing pause command.
   */
  async pausePostProcessing(): Promise<boolean> {
    return this.command({ mode: 'pause_pp' });
  }

  /**
   * Resumes post-processing tasks.
   *
   * Calls SABnzbd `mode=resume_pp`.
   *
   * @returns `true` when SABnzbd accepts the post-processing resume command.
   */
  async resumePostProcessing(): Promise<boolean> {
    return this.command({ mode: 'resume_pp' });
  }

  /**
   * Triggers immediate RSS processing.
   *
   * Calls SABnzbd `mode=rss_now`.
   *
   * @returns `true` when SABnzbd accepts the RSS trigger command.
   */
  async fetchRss(): Promise<boolean> {
    return this.command({ mode: 'rss_now' });
  }

  /**
   * Triggers an immediate scan of the watched folder.
   *
   * Calls SABnzbd `mode=watched_now`.
   *
   * @returns `true` when SABnzbd accepts the watched-folder scan command.
   */
  async scanWatchedFolder(): Promise<boolean> {
    return this.command({ mode: 'watched_now' });
  }

  /**
   * Resets SABnzbd quota counters.
   *
   * Calls SABnzbd `mode=reset_quota`.
   *
   * @returns `true` when SABnzbd accepts the quota reset command.
   */
  async resetQuota(): Promise<boolean> {
    return this.command({ mode: 'reset_quota' });
  }

  /**
   * Clears currently active warnings.
   *
   * Calls SABnzbd `mode=warnings` with `name=clear`.
   *
   * @returns `true` when SABnzbd accepts the warning clear command.
   */
  async clearWarnings(): Promise<boolean> {
    return this.command({ mode: 'warnings', name: 'clear' });
  }

  /**
   * Pauses a queue job by its SAB `nzo_id`.
   *
   * Calls SABnzbd `mode=queue` with `name=pause`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @returns `true` when SABnzbd accepts the job pause command.
   */
  async pauseJob(id: string): Promise<boolean> {
    return this.command({ mode: 'queue', name: 'pause', value: id });
  }

  /**
   * Resumes a queue job by its SAB `nzo_id`.
   *
   * Calls SABnzbd `mode=queue` with `name=resume`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @returns `true` when SABnzbd accepts the job resume command.
   */
  async resumeJob(id: string): Promise<boolean> {
    return this.command({ mode: 'queue', name: 'resume', value: id });
  }

  /**
   * Deletes a queue job by its SAB `nzo_id`.
   *
   * Calls SABnzbd `mode=queue` with `name=delete`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param deleteFiles When `true`, also remove downloaded data files; defaults to `false`.
   * @returns `true` when SABnzbd accepts the delete command.
   */
  async deleteJob(id: string, deleteFiles = false): Promise<boolean> {
    return this.command({
      mode: 'queue',
      name: 'delete',
      value: id,
      del_files: deleteFiles ? '1' : '0',
    });
  }

  /**
   * Deletes a history job by its SAB `nzo_id`.
   *
   * Calls SABnzbd `mode=history` with `name=delete`. SAB archives the job by default instead of
   * deleting it permanently, and `del_files` only removes the incomplete download folder of
   * failed jobs.
   *
   * @see https://github.com/sabnzbd/sabnzbd/blob/develop/sabnzbd/api.py (`_api_history_delete`)
   * @param id SAB history job identifier (`nzo_id`).
   * @param deleteFiles When `true`, also remove leftover files of failed jobs; defaults to `false`.
   * @param archive When `false`, permanently delete instead of archiving; defaults to SAB's setting.
   * @returns `true` when SABnzbd accepts the delete command.
   */
  async deleteHistory(id: string, deleteFiles = false, archive?: boolean): Promise<boolean> {
    return this.command({
      mode: 'history',
      name: 'delete',
      value: id,
      del_files: deleteFiles ? '1' : '0',
      archive: archive === undefined ? undefined : toQueryStringValue(archive),
    });
  }

  /**
   * Removes all queue jobs, optionally only those whose name contains `search`. Downloaded
   * files are deleted too.
   *
   * Calls SABnzbd `mode=queue` with `name=purge`.
   *
   * @param search Optional case-insensitive name filter.
   * @returns The removed queue ids.
   */
  async purgeQueue(search?: string): Promise<string[]> {
    const response = await this.request<SabRemoveResponse>(
      { mode: 'queue', name: 'purge', search },
      { allowFalseStatus: true },
    );
    return response.nzo_ids;
  }

  /**
   * Sorts the queue. SAB keeps priority ordering, sorting only within each priority.
   *
   * Calls SABnzbd `mode=queue` with `name=sort`.
   *
   * @param sort Field to sort by.
   * @param direction Sort direction; defaults to ascending.
   * @returns `true` when SABnzbd accepts the sort command.
   */
  async sortQueue(sort: SabQueueSortField, direction: SabSortDirection = 'asc'): Promise<boolean> {
    return this.command({ mode: 'queue', name: 'sort', sort, dir: direction });
  }

  /**
   * Pauses the queue and resumes it automatically after `minutes`.
   *
   * Calls SABnzbd `mode=config` with `name=set_pause`.
   *
   * @param minutes Minutes to pause for.
   * @returns `true` when SABnzbd accepts the timed pause.
   */
  async pauseQueueFor(minutes: number): Promise<boolean> {
    return this.command({ mode: 'config', name: 'set_pause', value: `${minutes}` });
  }

  /**
   * Re-queues a failed history job.
   *
   * Calls SABnzbd `mode=retry`.
   *
   * @param id SAB history job identifier (`nzo_id`).
   * @param password Optional archive password for the retried job.
   * @returns The new queue id. SAB removes the history entry.
   */
  async retryJob(id: string, password?: string): Promise<string> {
    const response = await this.request<SabRetryResponse>({ mode: 'retry', value: id, password });
    const newId = getRetriedJobId(response.nzo_id);
    if (!newId) {
      throw new Error('SABnzbd did not return a queue id');
    }

    return newId;
  }

  /**
   * Re-queues every retryable failed history job.
   *
   * Calls SABnzbd `mode=retry_all`.
   *
   * @returns The new queue ids.
   */
  async retryAll(): Promise<string[]> {
    const response = await this.request<SabRetryAllResponse>({ mode: 'retry_all' });
    return response.status.flatMap(value => (value ? (getRetriedJobId(value) ?? []) : []));
  }

  /**
   * Cancels post-processing of a job.
   *
   * Calls SABnzbd `mode=cancel_pp`.
   *
   * @param id SAB job identifier (`nzo_id`) currently in post-processing.
   * @returns `true` when SABnzbd cancels post-processing.
   */
  async cancelPostProcessing(id: string): Promise<boolean> {
    return this.command({ mode: 'cancel_pp', value: id });
  }

  /**
   * Moves a queue job to a target position.
   *
   * Calls SABnzbd `mode=switch`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param position Target zero-based queue position.
   * @returns `true` when SABnzbd accepts the move command.
   */
  async moveJob(id: string, position: number): Promise<boolean> {
    return this.command({
      mode: 'switch',
      value: id,
      value2: `${position}`,
    });
  }

  /**
   * Changes a queue job category.
   *
   * Calls SABnzbd `mode=change_cat`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param category SAB category name.
   * @returns `true` when SABnzbd accepts the category change.
   */
  async changeCategory(id: string, category: string): Promise<boolean> {
    return this.command({
      mode: 'change_cat',
      value: id,
      value2: category,
    });
  }

  /**
   * Changes a queue job post-processing script.
   *
   * Calls SABnzbd `mode=change_script`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param script SAB configured script name.
   * @returns `true` when SABnzbd accepts the script change.
   */
  async changeScript(id: string, script: string): Promise<boolean> {
    return this.command({
      mode: 'change_script',
      value: id,
      value2: script,
    });
  }

  /**
   * Changes queue job priority.
   *
   * Calls SABnzbd `mode=queue` with `name=priority`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param priority Shared normalized priority value.
   * @returns The new queue position when reported by SABnzbd, otherwise `undefined`.
   */
  async changePriority(id: string, priority: UsenetPriority): Promise<number | undefined> {
    const response = await this.request<SabPositionResponse>({
      mode: 'queue',
      name: 'priority',
      value: id,
      value2: `${normalizedPriorityToSab(priority)}`,
    });
    return response.position;
  }

  /**
   * Changes queue job post-processing options.
   *
   * Calls SABnzbd `mode=change_opts`. SAB only accepts explicit modes here, so
   * `UsenetPostProcess.default` throws instead of being sent; there is no API to reset a job
   * back to its category default.
   *
   * @see https://github.com/sabnzbd/sabnzbd/blob/develop/sabnzbd/api.py (`_api_change_opts`)
   * @param id SAB queue job identifier (`nzo_id`).
   * @param postProcess Normalized post-processing mode to apply.
   * @returns `true` when SABnzbd accepts the option change.
   */
  async changePostProcess(
    id: string,
    postProcess: NormalizedAddNzbOptions['postProcess'],
  ): Promise<boolean> {
    const value = normalizeAddPostProcess(postProcess);
    if (value === -1) {
      throw new RangeError('SABnzbd cannot reset a queued job to the default post-process mode');
    }

    return this.command({
      mode: 'change_opts',
      value: id,
      value2: `${value}`,
    });
  }

  /**
   * Renames a queue job and optionally sets an archive password.
   *
   * Calls SABnzbd `mode=queue` with `name=rename`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param name New queue job name.
   * @param password Optional archive password; left unchanged when omitted.
   * @returns `true` when SABnzbd accepts the rename command.
   */
  async renameJob(id: string, name: string, password?: string): Promise<boolean> {
    return this.command({
      mode: 'queue',
      name: 'rename',
      value: id,
      value2: name,
      value3: password,
    });
  }

  /**
   * Lists files for a queue job.
   *
   * Calls SABnzbd `mode=get_files`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @returns The raw file listing payload.
   */
  async getFiles(id: string): Promise<SabFilesResponse> {
    return this.request<SabFilesResponse>({ mode: 'get_files', value: id });
  }

  /**
   * Sets the global download speed limit.
   *
   * Calls SABnzbd `mode=config` with `name=speedlimit`.
   *
   * @param limit Speed limit value passed directly to SABnzbd.
   * @returns `true` when SABnzbd accepts the speed limit update.
   */
  async setSpeedLimit(limit: string | number): Promise<boolean> {
    return this.command({
      mode: 'config',
      name: 'speedlimit',
      value: `${limit}`,
    });
  }

  /**
   * Adds an NZB to the queue from a URL.
   *
   * Calls SABnzbd `mode=addurl`.
   *
   * @param url Remote NZB URL.
   * @param options Optional SAB add fields; defaults include `category="*"`, `script="Default"`,
   * `priority=-100`, and `postProcess=-1`.
   * @returns The raw SAB add response containing status and optional `nzo_ids`.
   */
  async addUrl(url: string, options: SabAddOptions = {}): Promise<SabAddResponse> {
    const response = await this.request<SabAddResponse>({
      mode: 'addurl',
      name: url,
      ...getSabAddFields(options),
    });

    return response;
  }

  /**
   * Adds an NZB to the queue by file upload.
   *
   * Calls SABnzbd `mode=addfile`.
   *
   * @param nzb NZB XML content as text or bytes.
   * @param options Optional SAB add fields; defaults include `category="*"`, `script="Default"`,
   * `priority=-100`, and `postProcess=-1`.
   * @returns The raw SAB add response containing status and optional `nzo_ids`.
   */
  async addFile(nzb: string | Uint8Array, options: SabAddOptions = {}): Promise<SabAddResponse> {
    const form = buildAddFileForm(this.config, nzb, options);
    return this.request<SabAddResponse>({}, { method: 'POST', body: form });
  }

  async getQueue(): Promise<NormalizedUsenetJob[]> {
    const queue = await this.listQueue();
    return queue.slots.map(normalizeSabJob);
  }

  async getHistory(): Promise<NormalizedUsenetHistoryItem[]> {
    const history = await this.listHistory();
    return history.slots.map(normalizeSabHistoryItem);
  }

  async getQueueJob(id: string): Promise<NormalizedUsenetJob> {
    const job = await this.findQueueJob(id);
    if (!job) {
      throw new UsenetNotFoundError('sabnzbd', 'queueJob', id);
    }

    return job;
  }

  async getHistoryJob(id: string): Promise<NormalizedUsenetHistoryItem> {
    const historyItem = await this.findHistoryJob(id);
    if (!historyItem) {
      throw new UsenetNotFoundError('sabnzbd', 'historyJob', id);
    }

    return historyItem;
  }

  async findJob(id: string): Promise<FoundUsenetJob | null> {
    const queueJob = await this.findQueueJob(id);
    if (queueJob) {
      return {
        source: 'queue',
        job: queueJob,
      };
    }

    const historyJob = await this.findHistoryJob(id);
    if (historyJob) {
      return {
        source: 'history',
        job: historyJob,
      };
    }

    return null;
  }

  async getAllData(): Promise<AllClientData> {
    const [queue, history, fullStatus, categories, scripts] = await Promise.all([
      this.listQueue(),
      this.listHistory(),
      this.getFullStatus(),
      this.getCategories(),
      this.getScripts(),
    ]);

    return {
      categories,
      scripts,
      queue: queue.slots.map(normalizeSabJob),
      history: history.slots.map(normalizeSabHistoryItem),
      status: normalizeSabStatus(queue, fullStatus),
      raw: {
        queue,
        history,
        fullStatus,
      },
    };
  }

  /**
   * Removes a job from the queue, falling back to history when the id is not queued.
   */
  async removeJob(id: string, removeData = false): Promise<boolean> {
    const response = await this.request<SabRemoveResponse>(
      {
        mode: 'queue',
        name: 'delete',
        value: id,
        del_files: removeData ? '1' : '0',
      },
      { allowFalseStatus: true },
    );
    if (response.nzo_ids.includes(id)) {
      return true;
    }

    if (!(await this.findHistoryJob(id))) {
      throw new UsenetNotFoundError('sabnzbd', 'historyJob', id);
    }

    return this.deleteHistory(id, removeData);
  }

  async setCategory(id: string, category: string): Promise<boolean> {
    return this.changeCategory(id, category);
  }

  async setPriority(id: string, priority: UsenetPriority): Promise<boolean> {
    await this.changePriority(id, priority);
    return true;
  }

  async addNzbFile(
    nzb: string | Uint8Array,
    options: Partial<NormalizedAddNzbOptions> = {},
  ): Promise<string> {
    const response = await this.addFile(nzb, normalizeAddOptions(options));
    return getAddedJobId(response);
  }

  async addNzbUrl(url: string, options: Partial<NormalizedAddNzbOptions> = {}): Promise<string> {
    const response = await this.addUrl(url, normalizeAddOptions(options));
    return getAddedJobId(response);
  }

  async normalizedAddNzb(
    input: NzbInput,
    options: Partial<NormalizedAddNzbOptions> = {},
  ): Promise<NormalizedUsenetJob> {
    const id =
      'url' in input
        ? await this.addNzbUrl(input.url, options)
        : await this.addNzbFile(input.file, options);

    return this.waitForQueueJob(id);
  }

  private async waitForQueueJob(id: string): Promise<NormalizedUsenetJob> {
    for (let attempt = 0; attempt < addQueuePollAttempts; attempt++) {
      try {
        return await this.getQueueJob(id);
      } catch (error) {
        if (!isUsenetNotFoundError(error)) {
          throw error;
        }
      }

      if (attempt < addQueuePollAttempts - 1) {
        await sleep(addQueuePollIntervalMs);
      }
    }

    throw new UsenetNotFoundError('sabnzbd', 'queueJob', id);
  }

  private async findQueueJob(id: string): Promise<NormalizedUsenetJob | undefined> {
    const queue = await this.listQueue({ nzoIds: id });
    const slot = queue.slots.find(item => item.nzo_id === id);
    return slot ? normalizeSabJob(slot) : undefined;
  }

  private async findHistoryJob(id: string): Promise<NormalizedUsenetHistoryItem | undefined> {
    const history = await this.listHistory({ nzoIds: id });
    const item = history.slots.find(slot => slot.nzo_id === id);
    return item ? normalizeSabHistoryItem(item) : undefined;
  }

  private async command(params: SabRequestParams): Promise<boolean> {
    await this.request<unknown>(params);
    return true;
  }

  private async request<T>(params: SabRequestParams, options: SabRequestOptions = {}): Promise<T> {
    return requestSab<T>(this.config, params, options);
  }
}

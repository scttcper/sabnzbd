import type { LiteralUnion } from 'type-fest';

export type SabStatus =
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
  | 'Propagating';

/**
 * Raw SABnzbd job status value from queue/history payloads.
 *
 * Use the documented `SabStatus` union when you want exhaustiveness over known
 * values. Raw payload fields remain open to unknown statuses so newer SABnzbd
 * releases do not become type-incompatible.
 */
export type SabRawStatus = LiteralUnion<SabStatus, string>;

/**
 * Documented queue status filter values accepted by `mode=queue`.
 */
export type SabQueueStatusFilter =
  | 'Checking'
  | 'Downloading'
  | 'Fetching'
  | 'Grabbing'
  | 'Paused'
  | 'Propagating'
  | 'Queued';

/**
 * Documented history status filter values accepted by `mode=history`.
 */
export type SabHistoryStatusFilter =
  | 'Completed'
  | 'Extracting'
  | 'Failed'
  | 'Fetching'
  | 'Moving'
  | 'Queued'
  | 'QuickCheck'
  | 'Repairing'
  | 'Running'
  | 'Verifying';

/**
 * Documented SABnzbd numeric priority values.
 */
export type SabPriorityValue = -100 | -4 | -3 | -2 | -1 | 0 | 1 | 2;

/**
 * Raw SABnzbd priority value from payloads, which may be numeric or stringified.
 */
export type SabRawPriorityValue = SabPriorityValue | `${SabPriorityValue}`;

/**
 * Documented SABnzbd queue post-processing values.
 */
export type SabPostProcessValue = -1 | 0 | 1 | 2 | 3;

/**
 * Raw SABnzbd queue post-processing value from payloads.
 */
export type SabRawPostProcessValue = SabPostProcessValue | `${SabPostProcessValue}`;

/**
 * Documented SABnzbd history post-processing status codes.
 */
export type SabHistoryPostProcessValue = 'R' | 'U' | 'D';

/**
 * File status values documented by SABnzbd.
 */
export type SabFileStatus = LiteralUnion<'finished' | 'active' | 'queued', string>;

export interface SabBooleanResponse {
  /**
   * True/False status returned by command-style endpoints.
   *
   * SAB docs note some endpoints may still return `true` even when the operation failed.
   */
  status: boolean;
  /**
   * Optional list of affected queue ids (`nzo_id` values), when provided by SAB.
   */
  nzo_ids?: string[];
  error?: string;
}

export interface SabAuthResponse {
  /**
   * Authentication mode information returned by `mode=auth`.
   */
  auth: string;
}

export interface SabVersionResponse {
  /**
   * SABnzbd version string returned by `mode=version`.
   */
  version: string;
}

export type SabWarningType = LiteralUnion<'WARNING' | 'ERROR', string>;

export interface SabWarning {
  text: string;
  type: SabWarningType;
  time: number;
}

export interface SabWarningsResponse {
  warnings: SabWarning[];
}

export interface SabCategoriesResponse {
  /**
   * Configured category names returned by `mode=get_cats`.
   */
  categories: string[];
}

export interface SabScriptsResponse {
  /**
   * Configured script names returned by `mode=get_scripts`.
   */
  scripts: string[];
}

export interface SabAddResponse {
  /**
   * True/False status for add operations (`mode=addurl` / `mode=addfile`).
   */
  status: boolean;
  /**
   * Added queue ids (`nzo_id` values). SAB docs describe this as the add result payload.
   */
  nzo_ids: string[];
  error?: string;
}

export interface SabSwitchResponse {
  result?: {
    /**
     * Job priority after move/switch.
     */
    priority: number;
    /**
     * Job position after move/switch.
     */
    position: number;
  };
}

/**
 * Response from `mode=queue&name=delete` and `mode=queue&name=purge`.
 *
 * `status` is `false` when nothing was removed.
 */
export interface SabRemoveResponse {
  status: boolean;
  /**
   * Removed queue ids.
   */
  nzo_ids: string[];
}

/**
 * Re-queued job id from a retry. URL fetch retries return the `add_url` result tuple
 * (`["OK", [nzo_id]]`) instead of a plain id.
 *
 * @see https://github.com/sabnzbd/sabnzbd/blob/develop/sabnzbd/api.py (`retry_job`)
 */
export type SabRetriedJobId = string | [string, string[]];

export interface SabRetryResponse {
  status: boolean;
  nzo_id: SabRetriedJobId;
}

export interface SabRetryAllResponse {
  /**
   * One entry per retryable job, `null` when SAB could not re-queue it.
   */
  status: Array<SabRetriedJobId | null>;
}

/**
 * Fields accepted by `mode=queue&name=sort`.
 *
 * @see https://github.com/sabnzbd/sabnzbd/blob/develop/sabnzbd/nzbqueue.py (`sort_queue`)
 */
export type SabQueueSortField = 'name' | 'size' | 'avg_age' | 'remaining' | 'remaining_bytes';

export type SabSortDirection = 'asc' | 'desc';

export interface SabPositionResponse {
  /**
   * Queue position returned by priority updates, when provided by SAB.
   */
  position?: number;
}

export interface SabStatusConnection {
  thrdnum: number;
  nzo_name?: string;
  nzf_name?: string;
  art_name?: string;
}

export interface SabStatusServer {
  servername: string;
  servertotalconn: number;
  serverssl: number;
  serveractiveconn: number;
  serveroptional: number;
  serveractive: boolean;
  servererror: string;
  serverpriority: number;
  serverbps: string;
  serverconnections: SabStatusConnection[];
}

/**
 * Priority names SABnzbd reports on queue slots.
 *
 * Paused/stopped/duplicate priorities are not in SAB's interface map and fall back to the
 * numeric `0` (normal).
 *
 * @see https://github.com/sabnzbd/sabnzbd/blob/develop/sabnzbd/constants.py (`INTERFACE_PRIORITIES`)
 */
export type SabQueuePriorityName = 'Force' | 'Repair' | 'High' | 'Normal' | 'Low';

/**
 * Overall queue state reported by `mode=queue`.
 */
export type SabQueueState = LiteralUnion<'Idle' | 'Paused' | 'Downloading', string>;

export interface SabQueueSlot {
  /**
   * @deprecated not returned by SABnzbd queue slots, use `unpackopts`
   */
  pp?: SabRawPostProcessValue;
  status: SabRawStatus;
  index: number;
  timeleft: string;
  /**
   * Total size in MB.
   */
  mb: string;
  /**
   * Remaining size in MB.
   */
  mbleft: string;
  /**
   * Missing size in MB.
   */
  mbmissing: string;
  /**
   * Human-readable total size, e.g. `"100 B"`.
   */
  size: string;
  /**
   * Human-readable remaining size.
   */
  sizeleft: string;
  filename: string;
  /**
   * Priority name, or the numeric `0` fallback for priorities SAB has no name for.
   */
  priority: LiteralUnion<SabQueuePriorityName, string> | number;
  /**
   * Category name, `"*"` for the default category or `"None"` when unset.
   */
  cat: string;
  percentage: string;
  nzo_id: string;
  /**
   * UNIX timestamp (seconds) when the job was added.
   */
  time_added: number;
  /**
   * Script name, `"None"` when unset.
   */
  script: string;
  /**
   * Labels such as duplicate or propagation indicators.
   */
  labels: string[];
  password: string;
  /**
   * Post-processing option (`"0"`-`"3"`).
   */
  unpackopts: string;
  /**
   * Direct unpack progress, `null` when not active.
   */
  direct_unpack: string | null;
  /**
   * Average article age, e.g. `"926d"`, or `"-"` when unknown.
   */
  avg_age: string;
}

/**
 * Shared header fields SABnzbd includes in both `mode=queue` and `mode=fullstatus`.
 *
 * @see https://github.com/sabnzbd/sabnzbd/blob/develop/sabnzbd/api.py (`build_header`)
 */
export interface SabStatusHeader {
  version: string;
  paused: boolean;
  /**
   * Remaining timed pause (`"4:59"`), `"0"` when not paused for an interval.
   */
  pause_int: string;
  paused_all: boolean;
  /**
   * Free space in GB for the download folder.
   */
  diskspace1: string;
  /**
   * Free space in GB for the complete folder.
   */
  diskspace2: string;
  diskspace1_norm: string;
  diskspace2_norm: string;
  /**
   * Total space in GB for the download folder.
   */
  diskspacetotal1: string;
  /**
   * Total space in GB for the complete folder.
   */
  diskspacetotal2: string;
  /**
   * Speed limit as a percentage of the configured maximum line speed.
   */
  speedlimit: string;
  /**
   * Absolute speed limit in bytes per second, `"0"` when unlimited.
   */
  speedlimit_abs: string;
  have_warnings: string;
  /**
   * Action to run when the queue finishes, `null` when none.
   */
  finishaction: string | null;
  quota: string;
  have_quota: boolean;
  left_quota: string;
  cache_art: string;
  cache_size: string;
}

export interface SabQueue extends SabStatusHeader {
  status: SabQueueState;
  timeleft: string;
  /**
   * Current speed display value.
   */
  speed: string;
  kbpersec: string;
  mb: string;
  mbleft: string;
  size: string;
  sizeleft: string;
  /**
   * Number of jobs matching the current filters.
   */
  noofslots: number;
  /**
   * Total number of queue jobs.
   */
  noofslots_total: number;
  /**
   * Start index used for paged queue responses.
   */
  start: number;
  /**
   * Limit used for paged queue responses.
   */
  limit: number;
  finish: number;
  slots: SabQueueSlot[];
  [key: string]: unknown;
}

export interface SabHistoryStage {
  name: string;
  actions: string[];
}

export interface SabHistorySlot {
  fail_message: string;
  bytes: number;
  /**
   * Human-readable size.
   */
  size: string;
  /**
   * Bytes downloaded.
   */
  downloaded: number;
  /**
   * Category name, `"*"` for the default category.
   */
  category: string;
  nzb_name: string;
  /**
   * Download time in seconds.
   */
  download_time: number;
  /**
   * Post-processing time in seconds.
   */
  postproc_time: number;
  storage: string;
  /**
   * UNIX timestamp (seconds). For jobs still post-processing this is the current time.
   */
  completed: number;
  /**
   * UNIX timestamp (seconds) when the job was added.
   */
  time_added: number;
  /**
   * Duplicate matching key generated by SAB.
   */
  duplicate_key: string;
  /**
   * Script name, `"None"` when unset.
   */
  script: string;
  script_line: string;
  /**
   * History post-processing status code, empty when none.
   */
  pp: SabHistoryPostProcessValue | '';
  /**
   * Temporary destination path.
   */
  path: string;
  /**
   * `"future"` for URL fetches.
   */
  report: string;
  url: string;
  url_info: string;
  stage_log: SabHistoryStage[];
  completeness: number | null;
  meta: string | null;
  series: string | null;
  md5sum: string | null;
  password: string | null;
  /**
   * Current post-processing action, only set for jobs still post-processing.
   */
  action_line: string;
  /**
   * Whether the job is actively being post-processed.
   */
  loaded: boolean;
  /**
   * Whether SAB can retry the job.
   */
  retry: boolean;
  archive: boolean;
  status: SabRawStatus;
  nzo_id: string;
  name: string;
  [key: string]: unknown;
}

export interface SabHistory {
  /**
   * @deprecated never returned, use `day_size`
   */
  day?: string | number;
  /**
   * @deprecated never returned, use `week_size`
   */
  week?: string | number;
  /**
   * @deprecated never returned, use `month_size`
   */
  month?: string | number;
  /**
   * @deprecated never returned, use `total_size`
   */
  total?: string | number;
  /**
   * Human-readable total downloaded size.
   */
  total_size: string;
  month_size: string;
  week_size: string;
  day_size: string;
  slots: SabHistorySlot[];
  /**
   * Number of returned jobs still in post-processing.
   */
  ppslots: number;
  /**
   * Total number of history jobs matching the filters.
   */
  noofslots: number;
  /**
   * Pass back as `lastHistoryUpdate` to skip unchanged history.
   */
  last_history_update: number;
  version: string;
  [key: string]: unknown;
}

export interface SabFullStatus extends SabStatusHeader {
  /**
   * Only present when not using `skip_dashboard`.
   */
  localipv4?: string;
  ipv6?: string | null;
  publicipv4?: string | null;
  dnslookup?: boolean;
  active_socks5_proxy?: string | null;
  folders: string[];
  pystone: number;
  loadavg: string;
  downloaddir: string;
  downloaddirspeed: number;
  completedir: string;
  completedirspeed: number;
  internetbandwidth: number;
  delayed_assembler: number;
  loglevel: string;
  logfile: string;
  configfn: string;
  /**
   * @deprecated Not returned by current SABnzbd releases, use `windows`.
   */
  nt?: boolean;
  /**
   * @deprecated Not returned by current SABnzbd releases, use `macos`.
   */
  darwin?: boolean;
  /**
   * @deprecated Not returned by current SABnzbd releases.
   */
  cpumodel?: string;
  windows: boolean;
  macos: boolean;
  rtl: boolean;
  my_lcldata: string;
  my_home: string;
  url_base: string;
  apikey: string;
  cache_buster: string;
  confighelpuri: string;
  uptime: string;
  color_scheme: string;
  webdir: string;
  active_lang: string;
  /**
   * @deprecated Not returned by current SABnzbd releases.
   */
  restart_req?: boolean;
  power_options: boolean;
  /**
   * Whether a scheduled post-processing pause/resume exists. This is not the current
   * post-processing pause state, which SABnzbd does not expose.
   */
  pp_pause_event: boolean;
  pid: number;
  weblogfile: string | null;
  /**
   * Newer release version, `null` when up to date.
   */
  new_release: string | null;
  new_rel_url: string | null;
  warnings: SabWarning[];
  servers: SabStatusServer[];
  [key: string]: unknown;
}

export interface SabFile {
  nzf_id: string;
  filename: string;
  /**
   * File state in a job (`finished`, `active`, `queued`).
   */
  status?: SabFileStatus;
  /**
   * File age display string.
   */
  age?: string;
  /**
   * Par2 set id when applicable.
   */
  set?: string;
  mbleft?: string | number;
  mb?: string | number;
  bytes?: string | number;
  [key: string]: unknown;
}

export interface SabFilesResponse {
  files: SabFile[];
}

export interface SabServerStatsServer {
  /**
   * Bytes downloaded in the current day.
   */
  day: number;
  /**
   * Bytes downloaded in the current week.
   */
  week: number;
  /**
   * Bytes downloaded in the current month.
   */
  month: number;
  /**
   * Total bytes downloaded.
   */
  total: number;
  /**
   * Per-day byte totals keyed by `YYYY-MM-DD`.
   */
  daily: Record<string, number>;
  /**
   * Number of articles requested from this server.
   */
  articles_tried: number;
  /**
   * Number of successful article downloads from this server.
   */
  articles_success: number;
}

export interface SabServerStats {
  /**
   * Bytes downloaded in the current day.
   */
  day: number;
  /**
   * Bytes downloaded in the current week.
   */
  week: number;
  /**
   * Bytes downloaded in the current month.
   */
  month: number;
  /**
   * Total bytes downloaded.
   */
  total: number;
  /**
   * Per-server transfer stats keyed by server name.
   */
  servers: Record<string, SabServerStatsServer>;
}

export interface SabQueueQuery {
  /**
   * Index of the first queue job to return.
   */
  start?: number;
  /**
   * Number of queue jobs to return.
   */
  limit?: number;
  /**
   * Queue name filter.
   */
  search?: string;
  /**
   * Category filter (`cat`/`category`).
   */
  category?: string | string[];
  /**
   * Priority filter.
   */
  priority?: SabPriorityValue | SabPriorityValue[];
  /**
   * Queue status filter.
   */
  status?: SabQueueStatusFilter | SabQueueStatusFilter[];
  /**
   * Filter by one or more queue ids (`nzo_ids`).
   */
  nzoIds?: string | string[];
}

export interface SabHistoryQuery {
  /**
   * Index of the first history item to return.
   */
  start?: number;
  /**
   * Number of history items to return.
   */
  limit?: number;
  /**
   * History name filter.
   */
  search?: string;
  /**
   * Category filter (`cat`/`category`).
   */
  category?: string | string[];
  /**
   * History status filter.
   */
  status?: SabHistoryStatusFilter | SabHistoryStatusFilter[];
  /**
   * Filter by one or more ids (`nzo_ids`).
   */
  nzoIds?: string | string[];
  /**
   * Only include failed items.
   */
  failedOnly?: boolean;
  /**
   * Select archived history output.
   */
  archived?: boolean;
  /**
   * Return full output only when history changed since this value.
   */
  lastHistoryUpdate?: number | string;
}

export interface SabAddOptions {
  category?: string;
  script?: string;
  priority?: SabPriorityValue;
  postProcess?: SabPostProcessValue;
  name?: string;
  password?: string;
}

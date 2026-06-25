/**
 * TypeScript interfaces for YouGile REST API v2 resources.
 *
 * These mirror the documented fields we rely on. The API may return additional
 * fields; interfaces use optional members and we never assume completeness.
 */

/** Generic list response envelope. YouGile uses `content` (sometimes `data`). */
export interface ListEnvelope<T> {
  content?: T[];
  data?: T[];
  paging?: {
    limit?: number;
    offset?: number;
    count?: number;
    next?: string | number | null;
  };
}

export interface Project {
  id: string;
  title?: string;
  deleted?: boolean;
  users?: Record<string, string>;
  timestamp?: number;
}

export interface Board {
  id: string;
  title?: string;
  projectId?: string;
  deleted?: boolean;
  stickers?: Record<string, unknown>;
  timestamp?: number;
}

export interface Column {
  id: string;
  title?: string;
  boardId?: string;
  color?: number;
  deleted?: boolean;
  timestamp?: number;
}

export interface Deadline {
  deadline?: number;
  startDate?: number;
  withTime?: boolean;
  [key: string]: unknown;
}

export interface TimeTracking {
  plan?: number;
  work?: number;
  [key: string]: unknown;
}

export interface Task {
  id: string;
  title?: string;
  columnId?: string;
  description?: string;
  archived?: boolean;
  completed?: boolean;
  assigned?: string[];
  createdBy?: string;
  deadline?: Deadline | null;
  timeTracking?: TimeTracking | null;
  color?: string;
  /** Map of stickerId -> stateId (NOT an array). */
  stickers?: Record<string, string>;
  /** Short, human-facing id shown in the YouGile UI (e.g. "ABC-12"). */
  idTaskProject?: string;
  /** Chat id for the task's comment thread (usually equals the task id). */
  chatId?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface User {
  id: string;
  email?: string;
  realName?: string;
  name?: string;
  status?: string;
  isAdmin?: boolean;
  [key: string]: unknown;
}

export interface StickerState {
  id: string;
  name?: string;
  color?: string;
  [key: string]: unknown;
}

export interface Sticker {
  id: string;
  name?: string;
  icon?: string;
  deleted?: boolean;
  states?: StickerState[];
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string;
  text?: string;
  textHtml?: string;
  fromUserId?: string;
  label?: string;
  timestamp?: number;
  deleted?: boolean;
  [key: string]: unknown;
}

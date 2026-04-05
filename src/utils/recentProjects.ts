export type RecentProjectRecord = {
  path: string;
  name: string;
  format: 'package' | 'legacy-json';
  projectVersion: string;
  archiveVersion: string | null;
  thumbnailDataUrl: string | null;
  updatedAt: string | null;
  lastOpenedAt: string;
};

const RECENT_PROJECTS_KEY = 'spinebones:recent-projects';
const MAX_RECENT_PROJECTS = 12;

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const readRecentProjects = (): RecentProjectRecord[] => {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(RECENT_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentProjectRecord[];
    return parsed.filter((item) => typeof item.path === 'string' && typeof item.name === 'string');
  } catch {
    return [];
  }
};

const tryWriteRecentProjects = (entries: RecentProjectRecord[]) => {
  if (!isBrowser()) return true;

  try {
    window.localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
};

export const getRecentProjects = () => readRecentProjects();

export const rememberRecentProject = (
  entry: Omit<RecentProjectRecord, 'lastOpenedAt'>,
) => {
  const current = readRecentProjects().filter((item) => item.path !== entry.path);
  const nextEntries = [{
    ...entry,
    lastOpenedAt: new Date().toISOString(),
  }, ...current].slice(0, MAX_RECENT_PROJECTS);

  if (tryWriteRecentProjects(nextEntries)) return;

  const compactEntries = nextEntries.map((item) => ({
    ...item,
    thumbnailDataUrl: null,
  }));

  tryWriteRecentProjects(compactEntries);
};

export const removeRecentProject = (path: string) => {
  const next = readRecentProjects().filter((item) => item.path !== path);
  tryWriteRecentProjects(next);
};

export const clearRecentProjects = () => {
  if (!isBrowser()) return;
  window.localStorage.removeItem(RECENT_PROJECTS_KEY);
};

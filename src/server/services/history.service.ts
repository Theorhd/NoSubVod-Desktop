import fs from 'node:fs/promises';
import path from 'node:path';
import { HistoryEntry, WatchlistEntry } from '../../shared/types';

let historyFilePath: string = '';
let memoryHistory: Record<string, HistoryEntry> = {};
let watchlist: WatchlistEntry[] = [];

export async function initHistoryService(userDataPath: string) {
  historyFilePath = path.join(userDataPath, 'history.json');
  try {
    const data = await fs.readFile(historyFilePath, 'utf-8');
    const parsed = JSON.parse(data);
    memoryHistory = parsed.history || {};
    watchlist = parsed.watchlist || [];
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.error('Error reading history file:', error);
    }
    // Initialize empty if file doesn't exist
    memoryHistory = {};
    watchlist = [];
  }
}

async function saveHistoryToFile() {
  if (!historyFilePath) return;
  try {
    const dataToSave = {
      history: memoryHistory,
      watchlist: watchlist
    };
    await fs.writeFile(historyFilePath, JSON.stringify(dataToSave, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving history file:', error);
  }
}

export function getAllHistory(): Record<string, HistoryEntry> {
  return memoryHistory;
}

export function getHistoryByVodId(vodId: string): HistoryEntry | null {
  return memoryHistory[vodId] || null;
}

export async function updateHistory(vodId: string, timecode: number, duration: number) {
  if (timecode < 0) timecode = 0;
  
  memoryHistory[vodId] = {
    vodId,
    timecode,
    duration,
    updatedAt: Date.now()
  };
  
  await saveHistoryToFile();
  return memoryHistory[vodId];
}

export function getWatchlist(): WatchlistEntry[] {
  return watchlist;
}

export async function addToWatchlist(entry: WatchlistEntry) {
  if (!watchlist.some(item => item.vodId === entry.vodId)) {
    watchlist.push({ ...entry, addedAt: Date.now() });
    await saveHistoryToFile();
  }
  return watchlist;
}

export async function removeFromWatchlist(vodId: string) {
  watchlist = watchlist.filter(item => item.vodId !== vodId);
  await saveHistoryToFile();
  return watchlist;
}

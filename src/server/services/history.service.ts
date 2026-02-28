import fs from 'node:fs/promises';
import path from 'node:path';
import { HistoryEntry } from '../../shared/types';

let historyFilePath: string = '';
let memoryHistory: Record<string, HistoryEntry> = {};

export async function initHistoryService(userDataPath: string) {
  historyFilePath = path.join(userDataPath, 'history.json');
  try {
    const data = await fs.readFile(historyFilePath, 'utf-8');
    memoryHistory = JSON.parse(data);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.error('Error reading history file:', error);
    }
    // Initialize empty if file doesn't exist
    memoryHistory = {};
  }
}

async function saveHistoryToFile() {
  if (!historyFilePath) return;
  try {
    await fs.writeFile(historyFilePath, JSON.stringify(memoryHistory, null, 2), 'utf-8');
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

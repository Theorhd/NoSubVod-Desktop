import { useCallback, useEffect, useState } from 'react';
import { VOD } from '../../../shared/types';

export interface DownloadedFile {
  name: string;
  size: number;
  url: string;
  metadata?: VOD | null;
}

export interface ActiveDownload {
  vod_id: string;
  title: string;
  status: any;
  progress: number;
  current_time: string;
  total_duration: number;
}

const DEBUG_DOWNLOADS = false;

export function useDownloadsData() {
  const [files, setFiles] = useState<DownloadedFile[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDownloads = useCallback(async () => {
    try {
      const [filesRes, activeRes] = await Promise.all([
        fetch('/api/downloads'),
        fetch('/api/downloads/active'),
      ]);

      if (DEBUG_DOWNLOADS) {
        console.log('[Downloads] fetch /api/downloads status:', filesRes.status);
        console.log('[Downloads] fetch /api/downloads/active status:', activeRes.status);
      }

      if (filesRes.ok) {
        const data = (await filesRes.json()) as DownloadedFile[];
        if (DEBUG_DOWNLOADS) {
          console.log(
            '[Downloads] files received:',
            data.length,
            'files',
            data.map((f) => ({ name: f.name, size: f.size, url: f.url }))
          );
        }
        setFiles(data);
      } else {
        console.error(
          '[Downloads] /api/downloads failed:',
          filesRes.status,
          await filesRes.text().catch(() => '')
        );
      }

      if (activeRes.ok) {
        setActiveDownloads((await activeRes.json()) as ActiveDownload[]);
      }
    } catch (error) {
      console.error('[Downloads] Failed to fetch downloads', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDownloads();
    const interval = setInterval(() => {
      void fetchDownloads();
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchDownloads]);

  const resolveDownloadUrl = useCallback((url: string) => {
    if (!url) {
      console.warn('[Downloads] resolveDownloadUrl: empty url');
      return '';
    }

    let resolved: string;
    if (url.startsWith('/api/')) resolved = url;
    else if (url.startsWith('/shared-downloads/')) resolved = `/api${url}`;
    else if (url.startsWith('/')) resolved = `/api${url}`;
    else resolved = `/api/${url}`;

    const token = sessionStorage.getItem('nsv_token');
    if (token) {
      const sep = resolved.includes('?') ? '&' : '?';
      resolved = `${resolved}${sep}t=${encodeURIComponent(token)}`;
    }

    if (DEBUG_DOWNLOADS) {
      console.log('[Downloads] resolveDownloadUrl:', url, '->', resolved);
    }

    return resolved;
  }, []);

  return {
    files,
    activeDownloads,
    loading,
    fetchDownloads,
    resolveDownloadUrl,
  };
}

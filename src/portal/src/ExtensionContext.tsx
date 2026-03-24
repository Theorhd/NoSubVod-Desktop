import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Extension, ExtensionContribution } from '../../shared/types';
import { safeStorageGet } from '../../shared/utils/storage';

interface ExtensionContextType {
  extensions: Extension[];
  enabledExtensions: string[];
  contributions: ExtensionContribution[];
  registerContribution: (contribution: ExtensionContribution) => void;
  toggleExtension: (id: string, enabled: boolean) => Promise<void>;
  isLoading: boolean;
}

const ExtensionContext = createContext<ExtensionContextType | undefined>(undefined);

const ExtensionIframe = ({ src, title }: Readonly<{ src: string; title: string }>) => (
  <iframe
    src={src}
    style={{
      width: '100%',
      height: 'calc(100vh - 68px)',
      border: 'none',
      background: 'transparent',
    }}
    title={title}
  />
);

const ExtensionNavIcon = () => <div style={{ fontSize: '1.2rem' }}>🧩</div>;

export function ExtensionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [enabledExtensions, setEnabledExtensions] = useState<string[]>([]);
  const [contributions, setContributions] = useState<ExtensionContribution[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const registerContribution = useCallback((contribution: ExtensionContribution) => {
    setContributions((prev) => {
      if (prev.some((c) => c.id === contribution.id)) return prev;
      return [...prev, contribution];
    });
  }, []);

  const loadExtensions = useCallback(async () => {
    try {
      const [extRes, setsRes] = await Promise.all([
        fetch('/api/extensions'),
        fetch('/api/settings'),
      ]);

      if (!extRes.ok || !setsRes.ok) throw new Error('Failed to fetch extensions or settings');

      const allExtensions: Extension[] = await extRes.json();
      const settings = await setsRes.json();
      const enabledIds = settings.enabledExtensions || allExtensions.map((e) => e.manifest.id);

      setExtensions(allExtensions);
      setEnabledExtensions(enabledIds);

      // Clear previous contributions before reloading
      setContributions([]);

      // Get auth token for URL-based loading (scripts, iframes)
      const token =
        safeStorageGet(sessionStorage, 'nsv_token') || safeStorageGet(localStorage, 'nsv_token');
      const authSuffix = token ? `?t=${encodeURIComponent(token)}` : '';

      // Load extensions based on entry type
      for (const ext of allExtensions) {
        if (!enabledIds.includes(ext.manifest.id)) continue;

        const entry = ext.manifest.entry;
        const entryUrl = `/api/extensions/${ext.manifest.id}/${entry}${authSuffix}`;

        if (entry.endsWith('.html')) {
          // Automatically register a route for HTML-based extensions
          const path = `/ext/${ext.manifest.id}`;
          registerContribution({
            id: `auto-route-${ext.manifest.id}`,
            type: 'route',
            path,
            component: ExtensionIframe,
            componentProps: { src: entryUrl, title: ext.manifest.name },
          });

          // Also register a nav item if it's a "main" extension
          registerContribution({
            id: `auto-nav-${ext.manifest.id}`,
            type: 'nav',
            label: ext.manifest.name,
            path,
            component: ExtensionNavIcon,
          });
        } else {
          // Load as JS module
          const script = document.createElement('script');
          script.src = entryUrl;
          script.type = 'module';
          script.async = true;
          document.head.appendChild(script);
        }
      }
    } catch (error) {
      console.error('Error loading extensions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [registerContribution]);

  const toggleExtension = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        const newEnabled = enabled
          ? [...enabledExtensions, id]
          : enabledExtensions.filter((eid) => eid !== id);

        // Update settings on server
        const setsRes = await fetch('/api/settings');
        if (!setsRes.ok) return;
        const currentSettings = await setsRes.json();

        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...currentSettings,
            enabledExtensions: newEnabled,
          }),
        });

        // We need a full page reload or a way to "unload" scripts to properly toggle
        // For now, we update local state and let the user know a reload might be needed
        // or we just reload the extension list which will re-register contributions.
        // NOTE: JS scripts already in head won't be removed, but nav/routes will be updated.
        setEnabledExtensions(newEnabled);
        globalThis.location.reload(); // Simplest way to ensure "unloading" of JS extensions
      } catch (e) {
        console.error('Failed to toggle extension', e);
      }
    },
    [enabledExtensions]
  );

  useEffect(() => {
    // Expose Global API for extensions
    (globalThis as any).NSV = {
      registerContribution,
    };

    loadExtensions();
  }, [loadExtensions, registerContribution]);

  const contextValue = useMemo(
    () => ({
      extensions,
      enabledExtensions,
      contributions,
      registerContribution,
      toggleExtension,
      isLoading,
    }),
    [extensions, enabledExtensions, contributions, registerContribution, toggleExtension, isLoading]
  );

  return <ExtensionContext.Provider value={contextValue}>{children}</ExtensionContext.Provider>;
}

export const useExtensions = () => {
  const context = useContext(ExtensionContext);
  if (!context) {
    throw new Error('useExtensions must be used within an ExtensionProvider');
  }
  return context;
};

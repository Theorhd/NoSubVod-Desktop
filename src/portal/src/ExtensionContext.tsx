import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Extension, ExtensionContribution } from '../../shared/types';

interface ExtensionContextType {
  extensions: Extension[];
  contributions: ExtensionContribution[];
  registerContribution: (contribution: ExtensionContribution) => void;
  isLoading: boolean;
}

const ExtensionContext = createContext<ExtensionContextType | undefined>(undefined);

export function ExtensionProvider({ children }: { children: React.ReactNode }) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [contributions, setContributions] = useState<ExtensionContribution[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const registerContribution = useCallback((contribution: ExtensionContribution) => {
    setContributions((prev) => {
      if (prev.find((c) => c.id === contribution.id)) return prev;
      return [...prev, contribution];
    });
  }, []);

  useEffect(() => {
    // Expose Global API for extensions
    (window as any).NSV = {
      registerContribution,
      // On peut ajouter ici d'autres méthodes d'API (fetch, storage, etc.)
    };

    const loadExtensions = async () => {
      try {
        const response = await fetch('/api/extensions');
        if (!response.ok) throw new Error('Failed to fetch extensions');
        const data: Extension[] = await response.json();
        setExtensions(data);

        // Load entry scripts
        for (const ext of data) {
          const script = document.createElement('script');
          script.src = `/api/extensions/${ext.manifest.id}/${ext.manifest.entry}`;
          script.type = 'module';
          script.async = true;
          document.head.appendChild(script);
        }
      } catch (error) {
        console.error('Error loading extensions:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadExtensions();
  }, [registerContribution]);

  return (
    <ExtensionContext.Provider
      value={{ extensions, contributions, registerContribution, isLoading }}
    >
      {children}
    </ExtensionContext.Provider>
  );
}

export const useExtensions = () => {
  const context = useContext(ExtensionContext);
  if (!context) {
    throw new Error('useExtensions must be used within an ExtensionProvider');
  }
  return context;
};

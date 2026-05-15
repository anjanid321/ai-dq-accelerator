'use client';
import { useEffect, useState } from 'react';
import { ActiveThemeContext } from './useActiveTheme';
import { resolveTheme } from '@/lib/theme/resolve';
import { writeTokensToRoot } from '@/lib/theme/apply';

interface Props {
  initialClient?: string | null;
  children: React.ReactNode;
}

export function ThemeProvider({ initialClient = null, children }: Props) {
  const [theme, setTheme] = useState(() =>
    resolveTheme({
      searchParam: initialClient,
      envVar: process.env.NEXT_PUBLIC_CLIENT,
    })
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('client');
      if (param) {
        const resolved = resolveTheme({ searchParam: param, envVar: process.env.NEXT_PUBLIC_CLIENT });
        setTheme(resolved);
      }
    }
  }, []);

  useEffect(() => {
    writeTokensToRoot(theme);
  }, [theme]);

  return (
    <ActiveThemeContext.Provider value={theme}>
      {children}
    </ActiveThemeContext.Provider>
  );
}

import { ConfigProvider, ThemeProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './global.css';
import App from './App';
import { algorithm } from './theme';
import type { Report } from './types';

const FONT = '"Geist", -apple-system, "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif';
const FONT_CODE = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';

async function load(): Promise<Report> {
  const raw = document.getElementById('report-data')?.textContent ?? '';
  if (!raw.startsWith('__') && raw.trim()) return JSON.parse(raw);
  // Dev server only: a sample produced by `report.py --model`.
  return (await fetch('/dev/sample/model.json')).json();
}

function Root({ report }: { report: Report }) {
  // lobe-ui merges `theme` as an object, so the palette follows the system scheme here.
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const update = () => setDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const appearance = dark ? 'dark' : 'light';
  return (
    <ThemeProvider
      appearance={appearance}
      enableCustomFonts={false}
      themeMode={appearance}
      theme={{
        algorithm: algorithm(dark),
        token: { fontFamily: FONT, fontFamilyCode: FONT_CODE, borderRadius: 8, borderRadiusLG: 12 },
      }}
    >
      <ConfigProvider config={{ customCdnFn: () => '', proxy: 'custom' }} locale={'zh-CN'} motion={motion}>
        <App report={report} />
      </ConfigProvider>
    </ThemeProvider>
  );
}

load().then((report) => {
  document.title = `${report.title} · 交付验证`;
  createRoot(document.getElementById('root')!).render(<Root report={report} />);
});

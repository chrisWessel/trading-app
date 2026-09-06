export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export const getWsUrl = (path: string) => {
  let base = process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || 'ws://127.0.0.1:8000';
  base = base.replace(/\/$/, '');
  if (base.startsWith('http://')) {
    base = base.replace('http://', 'ws://');
  } else if (base.startsWith('https://')) {
    base = base.replace('https://', 'wss://');
  } else if (!base.startsWith('ws://') && !base.startsWith('wss://')) {
    base = `wss://${base}`;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
};

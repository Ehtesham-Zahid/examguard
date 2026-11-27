import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import App from './App';
import './index.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: 'var(--font-ui)' } }} />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// the first-visit loader (index.html) lifts away once the app has painted
declare global {
  interface Window {
    __hideSplash?: () => void;
  }
}
requestAnimationFrame(() => requestAnimationFrame(() => window.__hideSplash?.()));

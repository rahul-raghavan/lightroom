import { Suspense } from 'react';
import { LoginClient } from './login-client';

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
        <LoginClient />
      </Suspense>
    </main>
  );
}

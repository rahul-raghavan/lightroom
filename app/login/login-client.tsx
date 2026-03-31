'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => {
    const rawNext = searchParams.get('next');
    if (!rawNext || !rawNext.startsWith('/')) return '/workspace';
    return rawNext;
  }, [searchParams]);

  const configError = searchParams.get('error') === 'config';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim()) {
      setError('Enter the site password.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not unlock the site.');
      }

      router.replace(nextPath);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not unlock the site.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md shadow-sm">
      <CardHeader className="space-y-3">
        <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <CardTitle className="text-2xl">Enter site password</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            This workspace is password protected.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="Password"
          />
          {configError && (
            <p className="text-sm text-red-600">
              Site password is not configured on the server yet.
            </p>
          )}
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <Button className="w-full" type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}
            Unlock workspace
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

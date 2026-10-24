import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { useAuth } from '@/contexts/AuthContext';

/** Two steps, like the tracker app: email, then the 6-digit code sent to it. */
export default function LoginPage() {
  const { sendCode, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (e: FormEvent, action: () => Promise<void>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
      <Paper variant="outlined" sx={{ p: 4, width: '100%', maxWidth: 400 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>Pico Reader</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>Sign in to your library</Typography>
        {step === 'email' ? (
          <form onSubmit={(e) => run(e, async () => { await sendCode(email.trim()); setStep('code'); })}>
            <Stack spacing={2}>
              <TextField label="Email" type="email" autoComplete="email" required autoFocus
                value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button type="submit" variant="contained" disableElevation disabled={busy}>Send sign-in code</Button>
            </Stack>
          </form>
        ) : (
          <form onSubmit={(e) => run(e, () => verifyCode(email.trim(), code.trim()))}>
            <Stack spacing={2}>
              <Typography variant="body2">If {email} can sign in, a 6-digit code is on its way. It expires in 10 minutes.</Typography>
              <TextField label="Code" required autoFocus inputMode="numeric" autoComplete="one-time-code"
                slotProps={{ htmlInput: { maxLength: 6, pattern: '[0-9]{6}' } }}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <Button type="submit" variant="contained" disableElevation disabled={busy || code.length !== 6}>Sign in</Button>
              <Button onClick={() => { setStep('email'); setCode(''); setError(''); }}>Use another email</Button>
            </Stack>
          </form>
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </Paper>
    </Box>
  );
}

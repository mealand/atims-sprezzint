import { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { ensureKey, backupPhrase, importPhrase } from '../lib/keys';
import { api } from '../lib/api';

/** Settings: device signing key + seed backup (M2.5) + password change (M6.1). */
export default function Settings() {
  const [ pubkey, setPubkey ] = useState('');
  const [ phrase, setPhrase ] = useState('');
  const [ input, setInput ] = useState('');
  const [ msg, setMsg ] = useState('');
  const [ revealed, setRevealed ] = useState(false);
  const [ curPw, setCurPw ] = useState('');
  const [ newPw, setNewPw ] = useState('');
  const [ newPw2, setNewPw2 ] = useState('');
  const [ pwMsg, setPwMsg ] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    ensureKey().then((k) => { setPubkey(k.pubkeyB64); setPhrase(backupPhrase()); });
  }, []);

  return (
    <DashboardLayout title="Settings — device signing key">
      <section className="card">
        <h3>Your device key</h3>
        <p className="muted tiny">Generated in this browser. The private key never leaves this device; the server only stores the public key and verifies signatures.</p>
        <p className="mono tiny">Public key (base64): {pubkey}</p>
        {revealed
          ? <p className="mono tiny" style={{ wordBreak: 'break-all' }}>SEED: {phrase}</p>
          : <button onClick={() => setRevealed(true)}>Reveal backup seed</button>}
        {revealed && <p className="error">Write this down — losing it means losing the ability to prove past signatures from a new device.</p>}
      </section>
      <section className="card">
        <h3>Restore from seed</h3>
        <div className="row">
          <input placeholder="64-hex seed phrase" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="atims-primary" onClick={async () => {
            const ok = await importPhrase(input.trim());
            setMsg(ok ? 'Key imported ✓' : 'Invalid seed ✗');
            if (ok) { const k = await ensureKey(); setPubkey(k.pubkeyB64); }
          }}>Import</button>
        </div>
        {msg && <p className="muted tiny">{msg}</p>}
      </section>
      <section className="card">
        <h3>Change password</h3>
        <p className="muted tiny">Rotate your account password. You stay logged in — this only changes the login credential.</p>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (newPw !== newPw2) { setPwMsg({ ok: false, text: 'New passwords do not match' }); return; }
          if (newPw.length < 10) { setPwMsg({ ok: false, text: 'New password must be at least 10 characters' }); return; }
          try {
            await api('/auth/password', { method: 'POST', body: { current_password: curPw, new_password: newPw } });
            setPwMsg({ ok: true, text: 'Password updated ✓' });
            setCurPw(''); setNewPw(''); setNewPw2('');
          } catch (err) { setPwMsg({ ok: false, text: (err as Error).message || 'Failed' }); }
        }}>
          <div className="row">
            <input type="password" placeholder="Current password" autoComplete="current-password"
              value={curPw} onChange={(e) => setCurPw(e.target.value)} required />
          </div>
          <div className="row">
            <input type="password" placeholder="New password (min 10 chars)" autoComplete="new-password"
              value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </div>
          <div className="row">
            <input type="password" placeholder="Repeat new password" autoComplete="new-password"
              value={newPw2} onChange={(e) => setNewPw2(e.target.value)} required />
          </div>
          <button type="submit" className="atims-primary">Update password</button>
        </form>
        {pwMsg && <p className={pwMsg.ok ? 'muted tiny' : 'error tiny'}>{pwMsg.text}</p>}
      </section>
    </DashboardLayout>
  );
}

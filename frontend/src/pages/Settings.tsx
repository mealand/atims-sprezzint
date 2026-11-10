import { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { ensureKey, backupPhrase, importPhrase } from '../lib/keys';

/** Settings: device signing key + seed backup (M2.5). */
export default function Settings() {
  const [ pubkey, setPubkey ] = useState('');
  const [ phrase, setPhrase ] = useState('');
  const [ input, setInput ] = useState('');
  const [ msg, setMsg ] = useState('');
  const [ revealed, setRevealed ] = useState(false);

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
    </DashboardLayout>
  );
}

/** ATiMs home — public shell, Sprezz brand palette. Anonymous visitors can
 * look up a batch trace or sign in. Logged-in users are routed by role (main.tsx). */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Home() {
  const [ traceId, setTraceId ] = useState('');
  const navigate = useNavigate();
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="mb-2 text-sm font-semibold uppercase tracking-widest" style={{ color: '#A349A4' }}>
        Sprezz Integrated Limited
      </p>
      <h1 className="text-4xl font-bold" style={{ color: '#A81D1D' }}>ATiMs</h1>
      <p className="mt-1 text-xl">Agro-Trace Integrated Management System</p>
      <p className="mt-6 text-slate-600">
        Signature-verified, hash-chained, publicly timestamped agricultural traceability with active
        compliance gates. Scan a batch QR to view its verified history.
      </p>
      <form className="mt-8 flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        const id = traceId.trim().toUpperCase();
        if (id) navigate(`/trace/${encodeURIComponent(id)}`);
      }}>
        <input
          name="traceId"
          placeholder="CROP-2026-XXXXXXXX"
          className="w-72 rounded border border-slate-300 px-3 py-2 uppercase"
          value={traceId}
          onChange={(e) => setTraceId(e.target.value)}
        />
        <button type="submit" className="atims-primary">Trace batch</button>
      </form>
      <p className="mt-4 flex gap-4 text-sm">
        <Link to="/login" className="font-semibold" style={{ color: '#A81D1D' }}>Log in →</Link>
        <Link to="/register" className="font-semibold" style={{ color: '#4CAF50' }}>Register as a supply-chain actor →</Link>
      </p>
      <div
        aria-hidden
        className="mt-12"
        style={{
          width: 84, height: 84, transform: 'rotate(45deg)',
          background: '#A81D1D', borderRadius: 12, margin: '48px auto',
        }}
      >
        <div style={{ transform: 'rotate(-45deg)', textAlign: 'center', lineHeight: '84px', color: '#fff', fontWeight: 700 }}>
          ATiMs
        </div>
      </div>
      <footer className="mt-8 text-center text-xs text-slate-400">
        Open-source stack · zero paid services · integrity provable by third parties.
      </footer>
    </main>
  );
}

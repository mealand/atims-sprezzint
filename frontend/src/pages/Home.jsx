/** ATiMs home — MVP shell. Sprezz-amber/green palette provisional pending final brand tokens. */
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-amber-600">
        Sprezz Integrated Limited
      </p>
      <h1 className="text-4xl font-bold text-emerald-800">ATiMs</h1>
      <p className="mt-1 text-xl">Agro-Trace Integrated Management System</p>
      <p className="mt-6 text-slate-600">
        Signature-verified, hash-chained, publicly timestamped agricultural traceability with active
        compliance gates. Scan a batch QR to view its verified history.
      </p>
      <form action="/trace" className="mt-8 flex gap-2" onSubmit={(e) => e.preventDefault()}>
        <input
          name="traceId"
          placeholder="CROP-2026-XXXXXXXX"
          className="w-72 rounded border border-slate-300 px-3 py-2 uppercase"
        />
      </form>
      <footer className="mt-16 text-xs text-slate-400">
        Open-source stack · zero paid services · integrity provable by third parties.
      </footer>
    </main>
  );
}

import { useParams } from 'react-router-dom';

/** Public trace page — fetches /trace/:id, shows verified history + integrity verdict. */
export default function Trace() {
  const { traceId } = useParams();
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-emerald-800">Batch {traceId}</h1>
      <p className="mt-4 text-slate-600 text-sm">Public trace view (API fetch wired in the next milestone).</p>
    </main>
  );
}

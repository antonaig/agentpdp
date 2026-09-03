export function SpecsTable({ specs }: { specs: Record<string, string> }) {
  const rows = Object.entries(specs ?? {}).filter(([, v]) => typeof v === "string" && v.trim());
  if (rows.length === 0) return null;
  return (
    <section className="pdp-section" aria-label="Specifications">
      <h3>Details</h3>
      <table className="specs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

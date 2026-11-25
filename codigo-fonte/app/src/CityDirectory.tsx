import { useEffect, useMemo, useState } from "react";
import { call } from "./api";
import { describeError } from "./format";
import type { City } from "./types";

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();

export function CityDirectory({ version, active }: { version: number; active: boolean }) {
  const [result, setResult] = useState<{ version: number; cities: City[]; error?: string }>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number>();
  useEffect(() => {
    if (!active || result?.version === version) return;
    let current = true;
    void call<City[]>("birth_cities").then(
      cities => { if (current) setResult({ version, cities }); },
      error => { if (current) setResult({ version, cities: [], error: describeError(error) }); },
    );
    return () => { current = false; };
  }, [active, version, result?.version]);

  const cities = result?.cities;
  const filtered = useMemo(() => {
    const term = normalize(query.trim());
    return (cities ?? []).filter(city => normalize(city.name).includes(term) || String(city.uid) === term);
  }, [cities, query]);
  const city = cities?.find(entry => entry.address === selected);

  return <section className={`workspace city-directory${active ? "" : " inactive"}`} aria-label="Cidades">
    <section className="players">
      <h2>Cidades da carreira</h2>
      <p className="note">Consulta às cidades de nascimento dos jogadores carregados.</p>
      <label className="search"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar cidade ou ID" /></label>
      {result?.version !== version && <p role="status">Lendo cidades da carreira…</p>}
      {result?.error && <p role="alert">{result.error}</p>}
      {!result?.error && result?.version === version && !filtered.length && <p>Nenhuma cidade encontrada.</p>}
      <div className="table-wrap">
        <table className="grid"><thead><tr><th>Cidade</th><th>ID</th></tr></thead><tbody>
          {filtered.slice(0, 200).map(entry => <tr key={entry.address}>
            <td><button className="name-link" type="button" aria-pressed={selected === entry.address}
              onClick={() => setSelected(entry.address)}>{entry.name}</button></td><td>{entry.uid ?? "—"}</td>
          </tr>)}
        </tbody></table>
      </div>
      {filtered.length > 200 && <p className="note">Mostrando 200 de {filtered.length}. Refine a busca para ver as demais.</p>}
    </section>
    {city && <section className="profile city-details">
      <header className="profile-head"><div className="profile-id"><h2>{city.name}</h2></div></header>
      <div className="profile-body"><dl className="stats">
        <div className="stat"><dt>ID</dt><dd>{city.uid ?? "Indisponível"}</dd></div>
        <div className="stat"><dt>ID do país</dt><dd>{city.nationUid ?? "Indisponível"}</dd></div>
      </dl><p className="note">A edição da cidade depende de um mapeamento validado para esta versão do jogo.</p></div>
    </section>}
  </section>;
}

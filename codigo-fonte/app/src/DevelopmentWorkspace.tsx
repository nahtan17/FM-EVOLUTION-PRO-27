import { useContext, useEffect, useState } from "react";
import { call } from "./api";
import { describeError, formatDate } from "./format";
import { fieldLabel } from "./labels";
import { GOALKEEPING, HIDDEN, MENTAL, PHYSICAL, TECHNICAL } from "./playerAttributes";
import { useRoleCatalog } from "./ProfileRoleGuide";
import { roleName } from "./ScoutParts";
import type { FmDate, PlayerSummary } from "./types";
import { EditorContext } from "./useProfileEditing";

export interface PlayerRef { uid: number; born: FmDate }
export interface Candidate {
  uid: number; born: FmDate | null; name: string; club: string; positions: string[];
  age: number | null; ability: number; potential: number | null; rawPotential: number;
  eligible: boolean; reason: string | null; focus: string[];
}
interface Rules {
  multiplier?: number | null; ceiling?: number | null; weeklyLimit?: number | null;
  frequency?: "daily" | "weekly" | null; paused?: boolean | null; focus?: string | null;
}
interface Group { players: PlayerRef[]; profile: string | null; rules: Rules }
interface Individual { player: PlayerRef; primary: string | null; profile: string | null; rules: Rules }
interface Settings {
  groups: Record<string, Group>; profiles: Record<string, Rules>;
  lists: Record<string, PlayerRef[]>; individuals: Record<string, Individual>;
}
const settingsSections = {
  lists: "Listas e favoritos", groups: "Grupos", profiles: "Perfis", individuals: "Regras individuais",
} as const;
type SettingsSection = keyof typeof settingsSections;
const sectionKeys = Object.keys(settingsSections) as SettingsSection[];

function SettingsBackup({settings, disabled, onDraft}:{settings:Settings;disabled:boolean;onDraft:(settings:Settings)=>void}) {
  const [contents,setContents] = useState("");
  const [selected,setSelected] = useState<SettingsSection[]>([]);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const [checking,setChecking] = useState(false);
  async function prepare() {
    setChecking(true);
    try {
      const backup: unknown = JSON.parse(contents);
      if (!backup || typeof backup !== "object" || !("version" in backup) || backup.version !== 1 ||
          !("settings" in backup) || !backup.settings || typeof backup.settings !== "object") {
        throw Error("Informe um backup de configurações do Desenvolvimento no formato JSON.");
      }
      const source = backup.settings as Partial<Settings>;
      for (const key of selected) {
        if (!source[key] || typeof source[key] !== "object" || Array.isArray(source[key])) {
          throw Error(`A seção ${settingsSections[key]} está ausente ou inválida.`);
        }
      }
      const update = Object.fromEntries(selected.map(key => [key,source[key]]));
      const checked = await call<Settings>("development_validate_settings",{settings:{...settings,...update}});
      onDraft(checked);
      setMessage("Seções carregadas no rascunho. Confira os vínculos e guarde as configurações para aplicar.");
      setError("");
    } catch (reason) {
      setError(describeError(reason));setMessage("");
    } finally { setChecking(false); }
  }
  return <details className="transfer-filters">
    <summary>Backup e restauração seletiva do Desenvolvimento</summary>
    <div className="trainer-row">
      <button disabled={disabled} onClick={()=>{
        setContents(JSON.stringify({version:1,settings},null,2));setError("");
        setMessage("Backup gerado. Guarde o JSON em um arquivo de texto.");
      }}>Gerar backup JSON</button>
      <button disabled={!contents} onClick={()=>void navigator.clipboard.writeText(contents)
        .then(()=>setMessage("JSON copiado."),reason=>setError(describeError(reason)))}>Copiar JSON</button>
    </div>
    <label>JSON do backup <textarea rows={6} value={contents} onChange={event=>{setContents(event.target.value);setMessage("");}} /></label>
    <div className="trainer-row">
      {sectionKeys.map(key=><label key={key}><input type="checkbox" checked={selected.includes(key)}
        onChange={event=>setSelected(previous=>event.target.checked?[...previous,key]:previous.filter(item=>item!==key))}/>
        {" "}{settingsSections[key]}</label>)}
      <button disabled={disabled||checking||!contents||!selected.length} onClick={()=>void prepare()}>Carregar seções no rascunho</button>
    </div>
    {message&&<p role="status" className="note">{message}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </details>;
}

export interface Workspace {
  session: string; label: string | null; revision: number;
  settings: Settings; selections: Record<string, PlayerRef[]>;
}
interface Snapshot {
  player: PlayerRef; name: string; club: string | null; date: FmDate; readAt: number;
  ability: number; potential: number; attributes: Record<string, number>; source: string;
}

const presets = ["Jovens promessas", "Sub-21", "Elenco principal", "Titulares", "Reservas", "Goleiros"];
const focusNames = {
  auto: "Automático pela posição", keeper: "Goleiros", goalkeeper: "Goleiros", defender: "Defensores",
  midfielder: "Meio-campistas", striker: "Atacantes", winger: "Pontas", none: "Sem foco",
};
const trainingAttributes = [...new Set([...TECHNICAL, ...MENTAL, ...PHYSICAL, ...GOALKEEPING])];
const attributes = [...trainingAttributes, ...HIDDEN];
const dateKey = (d: FmDate) => d.year * 10000 + d.month * 100 + d.day;
export const samePlayer = (a: PlayerRef, b: { uid: number; born: FmDate | null }) =>
  a.uid === b.uid && b.born !== null && dateKey(a.born) === dateKey(b.born);
const refFor = (row: Candidate): PlayerRef[] => row.born ? [{ uid: row.uid, born: row.born }] : [];
const emptyGroup: Group = {players: [], rules: {}, profile: null};
const favorites = "Favoritos";
const blankToNull = (value: string) => value === "" ? null : Number(value);
const mergeMembers = (before: PlayerRef[], incoming: PlayerRef[]) => [
  ...before.filter(member => !incoming.some(player => player.uid === member.uid)), ...incoming,
];

function RuleInputs({ rules, change }: { rules: Rules; change: (rules: Rules) => void }) {
  const { catalog } = useRoleCatalog();
  const custom = rules.focus?.startsWith("custom:") ?? false;
  const customKeys = custom ? rules.focus!.slice(7).split(",").filter(Boolean) : [];
  return <>
    <div className="trainer-form advanced-form">
      <label>Multiplicador<input type="number" min={1} max={100} value={rules.multiplier ?? ""} placeholder="Herdar"
        onChange={event => change({ ...rules, multiplier: blankToNull(event.target.value) })} /></label>
      <label>Teto de CA<input type="number" min={1} max={200} value={rules.ceiling ?? ""} placeholder="Herdar"
        onChange={event => change({ ...rules, ceiling: blankToNull(event.target.value) })} /></label>
      <label>Limite semanal<input type="number" min={1} max={200} value={rules.weeklyLimit ?? ""} placeholder="Herdar"
        onChange={event => change({ ...rules, weeklyLimit: blankToNull(event.target.value) })} /></label>
      <label>Frequência<select value={rules.frequency ?? ""} onChange={event => change({ ...rules, frequency: (event.target.value || null) as Rules["frequency"] })}>
        <option value="">Herdar</option><option value="weekly">Semanal</option><option value="daily">Diária</option>
      </select></label>
      <label>Estado<select value={rules.paused === null || rules.paused === undefined ? "" : String(rules.paused)}
        onChange={event => change({ ...rules, paused: event.target.value === "" ? null : event.target.value === "true" })}>
        <option value="">Herdar</option><option value="false">Ativo</option><option value="true">Pausado</option>
      </select></label>
      <label>Foco por posição<select value={custom ? "custom" : rules.focus ?? ""} onChange={event =>
        change({ ...rules, focus: event.target.value === "custom" ? "custom:" : event.target.value || null })}>
        <option value="">Herdar</option>
        {Object.entries(focusNames).filter(([key]) => key !== "keeper").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        <option value="custom">Atributos personalizados</option>
        {(catalog?.[1] ?? []).filter((role, index, roles) => roles.findIndex(item => item.key === role.key) === index).map(role =>
          <option key={role.key} value={`role:${role.key}`}>{roleName(role.key)}</option>)}
      </select></label>
    </div>
    {custom && <details><summary>Atributos prioritários · {customKeys.length}</summary>
      <div className="advanced-checkboxes">{trainingAttributes.map(key => <label className="trainer-check" key={key}>
        <input type="checkbox" checked={customKeys.includes(key)} onChange={event =>
          change({ ...rules, focus: `custom:${(event.target.checked ? [...customKeys, key] : customKeys.filter(value => value !== key)).join(",")}` })} />
        {fieldLabel("player", `attribute.${key}`)}
      </label>)}</div>
    </details>}
  </>;
}

type Area = "lists" | "groups" | "profiles" | "players";
export function DevelopmentWorkspace({ workspace, onUpdate, rows, selection, replaceSelection, busy }: {
  workspace: Workspace | undefined; onUpdate: (value: Workspace) => void; rows: Candidate[]; selection: Candidate[];
  replaceSelection: (refs: PlayerRef[]) => void; busy: boolean;
}) {
  const { openPlayer } = useContext(EditorContext);
  const [label, setLabel] = useState("");
  const [area, setArea] = useState<Area>("groups");
  const [selected, setSelected] = useState("");
  const [rename, setRename] = useState("");
  const [target, setTarget] = useState("");
  const [profileTarget, setProfileTarget] = useState(favorites);
  const [draft, setDraft] = useState<Settings>();
  const [members, setMembers] = useState<PlayerSummary[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const prefs = draft ?? workspace?.settings;
  const working = Boolean(draft);
  const chosenRefs = selection.flatMap(refFor);
  const change = (next: Settings) => { setDraft(next); setNotice(""); };
  useEffect(() => { setDraft(undefined); setNotice(""); setMembers([]); }, [workspace?.label, workspace?.session, workspace?.revision]);

  async function perform(job: () => Promise<void>) {
    setPending(true); setError(""); setNotice("");
    try { await job(); } catch (err) { setError(describeError(err)); }
    finally { setPending(false); }
  }
  const open = () => void perform(async () => {
    const next = await call<Workspace>("development_workspace", { name: label.trim() });
    onUpdate(next); setSelected(""); setRename(""); setMembers([]);
  });
  const save = () => workspace && draft && void perform(async () => {
    const next = await call<Workspace>("development_settings", {
      session: workspace.session, label: workspace.label, revision: workspace.revision, settings: draft,
    });
    onUpdate(next); setDraft(undefined); setNotice("Configurações guardadas. Aplique a seleção no painel 5× para atualizar os planos em execução.");
  });
  const available = area === "lists" ? Object.keys(prefs?.lists ?? {}) :
    area === "groups" ? Object.keys(prefs?.groups ?? {}) : Object.keys(prefs?.profiles ?? {});
  const names = area === "lists" ? [...new Set([favorites, ...available])] : available;
  const name = names.includes(selected) ? selected : names[0] ?? "";
  const listed = prefs?.lists[name] ?? [];
  const group = prefs?.groups[name] ?? emptyGroup;
  const rules = prefs?.profiles[name] ?? {};
  const current = rows.find(row => row.uid === Number(target));
  const currentRef = current && refFor(current)[0];
  const savedIndividual = currentRef && prefs?.individuals[currentRef.uid];
  const individual: Individual | undefined = currentRef
    ? savedIndividual && samePlayer(savedIndividual.player, currentRef) ? savedIndividual :
      { player: currentRef, primary: null, profile: null, rules: {} } : undefined;
  const affected = area === "lists" ? listed : group.players;

  function changeMembers(next: PlayerRef[]) {
    if (!prefs || !name) return;
    if (area === "lists") { change({ ...prefs, lists: { ...prefs.lists, [name]: next } }); return; }
    const individuals = { ...prefs.individuals };
    for (const [uid, entry] of Object.entries(individuals)) {
      if (entry.primary === name && !next.some(player => samePlayer(entry.player, player))) individuals[uid] = { ...entry, primary: null };
    }
    change({ ...prefs, groups: { ...prefs.groups, [name]: { ...group, players: next } }, individuals });
  }
  function create(value: string, old?: string) {
    const nextName = value.trim();
    if (!prefs || !nextName || names.includes(nextName)) { setError("Use um nome diferente dos existentes."); return; }
    const next = structuredClone(prefs);
    if (area === "lists") {
      next.lists[nextName] = old ? next.lists[old] ?? [] : [];
      if (old) delete next.lists[old];
    } else if (area === "groups") {
      next.groups[nextName] = old ? next.groups[old] : { ...emptyGroup, players: chosenRefs };
      if (old) {
        delete next.groups[old];
        for (const entry of Object.values(next.individuals)) if (entry.primary === old) entry.primary = nextName;
      }
    } else {
      next.profiles[nextName] = old ? next.profiles[old] : {};
      if (old) {
        delete next.profiles[old];
        for (const entry of [...Object.values(next.groups), ...Object.values(next.individuals)]) {
          if (entry.profile === old) entry.profile = nextName;
        }
      }
    }
    setSelected(nextName); setRename(""); setError(""); change(next);
  }
  function remove() {
    if (!prefs || !name || !window.confirm(`Excluir “${name}”?`)) return;
    const next = structuredClone(prefs);
    if (area === "lists") delete next.lists[name];
    if (area === "groups") {
      delete next.groups[name];
      for (const entry of Object.values(next.individuals)) if (entry.primary === name) entry.primary = null;
    }
    if (area === "profiles") {
      delete next.profiles[name];
      for (const entry of [...Object.values(next.groups), ...Object.values(next.individuals)]) {
        if (entry.profile === name) entry.profile = null;
      }
    }
    change(next); setSelected("");
  }
  function assignProfile(refs: PlayerRef[]) {
    if (!prefs || !name || !refs.length) return;
    const individuals = { ...prefs.individuals };
    for (const ref of refs) {
      const entry = individuals[ref.uid];
      individuals[ref.uid] = entry && samePlayer(entry.player, ref) ? { ...entry, profile: name } :
        { player: ref, profile: name, primary: null, rules: {} };
    }
    change({ ...prefs, individuals });
  }
  const inactive = busy || pending;
  const openList = () => void perform(async () => {
    const result = await call<{ summary: PlayerSummary }[]>("player_tools_list", { uids: listed.map(player => player.uid) });
    setMembers(result.map(row => row.summary).filter(row => listed.some(ref => samePlayer(ref, { uid: row.uid, born: row.dateOfBirth }))));
  });
  return <section className="development-selection" aria-label="Partida, grupos, perfis e listas">
    <div className="trainer-row trainer-between"><h3>Configurações da partida</h3><span>{workspace?.label ?? "Sessão atual"}</span></div>
    <form className="trainer-row" onSubmit={event => { event.preventDefault(); open(); }}>
      <label>Nome do save <input maxLength={80} value={label} onChange={event => setLabel(event.target.value)} /></label>
      <button disabled={inactive || working || !label.trim()}>Abrir ou criar perfil do save</button>
    </form>
    <p className="muted">Use um nome diferente para cada save. Ao carregar outra partida, selecione o perfil correspondente para recuperar listas, seleções e observações.</p>
    {prefs && <>
      <div className="trainer-tabs" role="tablist" aria-label="Organização do desenvolvimento">
        {([["groups", "Grupos"], ["players", "Regras individuais"], ["profiles", "Perfis de edição"], ["lists", "Favoritos e listas"]] as const)
          .map(([id, text]) => <button role="tab" key={id} aria-selected={id === area} onClick={() => {
            setArea(id); setSelected(""); setRename(""); setMembers([]);
          }}>{text}</button>)}
      </div>
      <fieldset disabled={inactive} className="advanced-fields">
        {area !== "players" && <>
          <div className="trainer-row">
            <label>{area === "groups" ? "Grupo" : area === "lists" ? "Lista" : "Perfil"} <select value={name}
              onChange={event => {setSelected(event.target.value); setMembers([]);}}>
              {!names.length && <option value="">Nenhum</option>}{names.map(value => <option key={value}>{value}</option>)}
            </select></label>
            <label>Nome <input value={rename} maxLength={80} onChange={event => setRename(event.target.value)} /></label>
            <button disabled={!rename.trim()} onClick={() => create(rename)}>Criar</button>
            <button disabled={!rename.trim() || !name || name === favorites} onClick={() => create(rename, name)}>Renomear</button>
            <button disabled={!name || name === favorites} onClick={remove}>Excluir</button>
          </div>
          {area === "groups" && <div className="trainer-row">
            <label>Sugestões <select value="" onChange={event => { if (event.target.value) setRename(event.target.value); }}>
              <option value="">Escolher nome sugerido</option>{presets.map(preset => <option key={preset}>{preset}</option>)}
            </select></label>
          </div>}
          {area !== "profiles" && name && <div className="trainer-row">
            <span>{affected.length} jogador(es)</span>
            <button disabled={!chosenRefs.length} onClick={() => changeMembers(mergeMembers(affected, chosenRefs))}>Adicionar seleção</button>
            <button disabled={!chosenRefs.length || !affected.length} onClick={() => changeMembers(affected.filter(member =>
              !chosenRefs.some(player => samePlayer(player, member))))}>Remover selecionados</button>
            <button disabled={!affected.length} onClick={() => replaceSelection(affected)}>Usar no painel 5×</button>
            {area === "lists" && <button disabled={!listed.length} onClick={openList}>Exibir jogadores da lista</button>}
          </div>}
        </>}
        {area === "lists" && members.length > 0 && <ul>{members.map(player => <li key={player.uid}>
          {openPlayer ? <button className="text-button" onClick={() => openPlayer(player)}>{player.name}</button> : player.name} · {player.club ?? "Sem clube"}
        </li>)}</ul>}
        {area === "groups" && name && <>
          <label>Perfil do grupo <select value={group.profile ?? ""} onChange={event =>
            change({ ...prefs, groups: { ...prefs.groups, [name]: { ...group, profile: event.target.value || null } } })}>
            <option value="">Herdar configuração geral</option>{Object.keys(prefs.profiles).map(value => <option key={value}>{value}</option>)}
          </select></label>
          <RuleInputs rules={group.rules} change={rules => change({ ...prefs, groups: { ...prefs.groups, [name]: { ...group, rules } } })} />
        </>}
        {area === "profiles" && name && <>
          <RuleInputs rules={rules} change={rules => change({ ...prefs, profiles: { ...prefs.profiles, [name]: rules } })} />
          <div className="trainer-row">
            <button disabled={!chosenRefs.length} onClick={() => assignProfile(chosenRefs)}>Vincular perfil aos selecionados</button>
            <label>Lista <select value={profileTarget} onChange={event => setProfileTarget(event.target.value)}>
              {[...new Set([favorites, ...Object.keys(prefs.lists)])].map(value => <option key={value}>{value}</option>)}
            </select></label>
            <button disabled={!prefs.lists[profileTarget]?.length} onClick={() => assignProfile(prefs.lists[profileTarget])}>Vincular perfil à lista</button>
          </div>
        </>}
        {area === "players" && <>
          <label>Jogador <select value={target} onChange={event => setTarget(event.target.value)}>
            <option value="">Selecione</option>{rows.filter(row => row.born).map(row => <option key={row.uid} value={row.uid}>{row.name}</option>)}
          </select></label>
          {individual && <>
            <div className="trainer-form advanced-form">
              <label>Grupo principal<select value={individual.primary ?? ""} onChange={event =>
                change({ ...prefs, individuals: { ...prefs.individuals, [individual.player.uid]: { ...individual, primary: event.target.value || null } } })}>
                <option value="">Automático</option>{Object.entries(prefs.groups).filter(([, group]) => group.players.some(player =>
                  samePlayer(player, individual.player))).map(([group]) => <option key={group}>{group}</option>)}
              </select></label>
              <label>Perfil individual<select value={individual.profile ?? ""} onChange={event =>
                change({ ...prefs, individuals: { ...prefs.individuals, [individual.player.uid]: { ...individual, profile: event.target.value || null } } })}>
                <option value="">Herdar</option>{Object.keys(prefs.profiles).map(value => <option key={value}>{value}</option>)}
              </select></label>
            </div>
            <RuleInputs rules={individual.rules} change={rules =>
              change({ ...prefs, individuals: { ...prefs.individuals, [individual.player.uid]: { ...individual, rules } } })} />
          </>}
        </>}
      </fieldset>
      {workspace && <SettingsBackup key={`${workspace.session}:${workspace.label}`} settings={workspace.settings} disabled={inactive || working} onDraft={change} />}
      <p className="muted">Regras individuais têm prioridade sobre as do grupo e as gerais. O foco aplica o bônus aos atributos elegíveis que já evoluíram no FM. O CA segue o limite configurado e o PA.</p>
      <div className="trainer-row"><button className="primary" disabled={inactive || !working} onClick={save}>Guardar configurações</button>
        <button disabled={inactive || !working} onClick={() => setDraft(undefined)}>Descartar rascunho</button></div>
    </>}
    {notice && <p className="trainer-notice" role="status">{notice}</p>}
    {error && <p className="banner" role="alert">{error}</p>}
  </section>;
}
const colors = ["#b99aff", "#6fcad5", "#edb76d", "#9bc790", "#eb8db7"];

function dateUtc(date: FmDate) { return Date.UTC(date.year, date.month - 1, date.day); }
function periodKey(date: FmDate, interval: "week" | "month") {
  if (interval === "month") return date.year * 100 + date.month;
  const day = new Date(dateUtc(date));
  return dateUtc(date) - ((day.getUTCDay() + 6) % 7) * 86400000;
}

export function DevelopmentChart({ candidates, workspace, event }: {
  candidates: Candidate[]; workspace: Workspace | undefined; event: number;
}) {
  const [ids, setIds] = useState<number[]>([]);
  const [interval, setInterval] = useState<"week" | "month">("week");
  const [metric, setMetric] = useState("ability");
  const [entries, setEntries] = useState<Snapshot[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ids.length || !workspace) return;
    let valid = true;
    setError("");
    call<Snapshot[]>("development_snapshots", { uids: ids }).then(
      rows => { if (valid) setEntries(rows); },
      err => { if (valid) { setEntries([]); setError(describeError(err)); } },
    );
    return () => { valid = false; };
  }, [ids, workspace?.session, workspace?.label, event, workspace]);
  const active = ids.length ? entries : [];
  const series = ids.map((uid, index) => {
    const periods = new Map<number, Snapshot>();
    const samples = active.filter(row => row.player.uid === uid)
      .sort((left, right) => dateKey(left.date) - dateKey(right.date) || left.readAt - right.readAt);
    for (const sample of samples) periods.set(periodKey(sample.date, interval), sample);
    const points = [...periods.values()].flatMap(sample => {
      const value = metric === "ability" ? sample.ability : metric === "potential" ? sample.potential > 0 ? sample.potential : null :
        metric === "gap" ? sample.potential > 0 ? Math.max(0, sample.potential - sample.ability) : null : sample.attributes[metric];
      return value === undefined || value === null ? [] : [{ sample, value, x: dateUtc(sample.date) }];
    });
    return { uid, points, color: colors[index], name: samples[samples.length - 1]?.name ?? candidates.find(row => row.uid === uid)?.name ?? String(uid) };
  });
  const points = series.flatMap(item => item.points);
  const first = Math.min(...points.map(point => point.x));
  const last = Math.max(...points.map(point => point.x));
  const max = attributes.some(key => key === metric) ? 20 : 200;
  const x = (day: number) => 49 + (first === last ? 0.5 : (day - first) / (last - first)) * 658;
  const y = (value: number) => 205 - value / max * 180;
  const choices = candidates.filter(row => row.born);
  return <section className="development-selection" aria-label="Gráfico de evolução real">
    <h3>Gráfico de evolução real</h3>
    <div className="trainer-row">
      <label>Adicionar jogador à comparação <select value="" disabled={ids.length === 5} onChange={event => {
        if (event.target.value) setIds(previous => [...previous, Number(event.target.value)]);
      }}><option value="">Selecione até cinco</option>{choices.filter(row => !ids.includes(row.uid)).map(row =>
        <option key={row.uid} value={row.uid}>{row.name}</option>)}</select></label>
      <label>Período <select value={interval} onChange={event => setInterval(event.target.value as typeof interval)}>
        <option value="week">Semanal</option><option value="month">Mensal</option>
      </select></label>
      <label>Indicador <select value={metric} onChange={event => setMetric(event.target.value)}>
        <option value="ability">CA</option><option value="potential">PA</option><option value="gap">Distância até o PA</option>
        {attributes.map(key => <option key={key} value={key}>{fieldLabel("player", `attribute.${key}`)}</option>)}
      </select></label>
    </div>
    <div className="trainer-row">{series.map(({uid, color, name}) => <button key={uid} style={{borderColor:color}}
      onClick={() => setIds(previous => previous.filter(id => id !== uid))}>{name} ×</button>)}</div>
    {points.length ? <>
      <svg className="development-chart" viewBox="0 0 760 231" role="img" aria-label="Evolução observada na data do FM">
        {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}>
          <line x1={45} x2={711} y1={y(fraction * max)} y2={y(fraction * max)} />
          <text x={36} y={y(fraction * max) + 4} textAnchor="end">{fraction * max}</text>
        </g>)}
        {series.map(({uid, points: values, color}) => <g key={uid}>
          <polyline points={values.map(point => `${x(point.x)},${y(point.value)}`).join(" ")} stroke={color} strokeWidth="2" fill="none" />
          {values.map(point => <circle key={point.x} cx={x(point.x)} cy={y(point.value)} r={4} fill={color}><title>
            {`${point.sample.name} · ${formatDate(point.sample.date)} · ${point.value}`}
          </title></circle>)}
        </g>)}
        <text x={45} y={225}>{new Date(first).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</text>
        {first !== last && <text x={711} y={225} textAnchor="end">{new Date(last).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</text>}
      </svg>
      <details><summary>Leituras do gráfico</summary><div className="trainer-table-scroll advanced-scroll"><table className="grid">
        <thead><tr><th>Data no FM</th><th>Jogador</th><th>Clube</th><th>CA</th><th>PA</th><th>Indicador</th><th>Origem</th></tr></thead>
        <tbody>{points.map(({ sample, value }) => <tr key={`${sample.player.uid}/${dateKey(sample.date)}`}>
          <td>{formatDate(sample.date)}</td><td>{sample.name}</td><td>{sample.club ?? "—"}</td><td>{sample.ability}</td>
          <td>{sample.potential > 0 ? sample.potential : "Indefinido"}</td><td>{value}</td><td>{sample.source}</td>
        </tr>)}</tbody>
      </table></div></details>
    </> : <p className="muted">Escolha jogadores com observações para o indicador. O gráfico usa a última leitura disponível de cada semana ou mês.</p>}
    {error && <p className="banner" role="alert">{error}</p>}
  </section>;
}

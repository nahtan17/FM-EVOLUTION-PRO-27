import { useState } from "react";
import type { SessionOverrides, SessionSlots, TrainingDay, TrainingPlan, TrainingWeek } from "./trainerApi";

interface Template {
  name: string;
  days: SessionSlots[];
}

const storageKey = "fmlivre.trainer.templates.v1";
const periods = ["Manhã", "Tarde", "Extra"];
const commonNames: Record<string, string> = {
  Rest: "Descanso", Recovery: "Recuperação", Match: "Partida", Travel: "Viagem",
  "Light Conditioning": "Condicionamento leve", Conditioning: "Condicionamento",
  "Heavy Conditioning": "Condicionamento intenso", "Team Bonding": "Convívio da equipe",
  "Individual Development": "Desenvolvimento individual", "Passing Style": "Estilo de passe",
  "Build Up": "Construção das jogadas", "Chance Creation": "Criação de chances",
  "In Possession Shape": "Estrutura com a bola", "Out Of Possession Shape": "Estrutura sem a bola",
  "Line of Engagement": "Linha de pressão", "Pressing Intensity": "Intensidade da pressão",
  "Pressing Trap": "Armadilha de pressão", "Corners": "Escanteios", "Free Kicks": "Faltas",
  "Penalties": "Pênaltis", "Possession Ball Work": "Trabalho de posse de bola",
};
const sessionName = (name: string) => commonNames[name] ?? name;
const shortDate = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("pt-BR");
const blankSlots = (): SessionSlots => [null, null, null];

function readTemplates(): Template[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter(item => typeof item?.name === "string" && Array.isArray(item.days)
      && item.days.length === 7 && item.days.every((slots: unknown) => Array.isArray(slots) && slots.length === 3
        && slots.every(code => code === null || Number.isInteger(code))));
  } catch {
    return [];
  }
}

export function TrainingCalendar({ plan, week, selectWeek, drafts, setDrafts, protectedDays, disabled, canApply, protectDay, protectWeek, apply }:
  { plan: TrainingPlan; week: TrainingWeek; selectWeek: (start: string) => void;
    drafts: SessionOverrides; setDrafts: (drafts: SessionOverrides) => void; protectedDays: string[];
    disabled: boolean; canApply: boolean; protectDay: (date: string, on: boolean) => void;
    protectWeek: (date: string, on: boolean) => void; apply: () => void }) {
  const [templates, setTemplates] = useState(readTemplates);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const catalog = new Map(plan.sessions);
  const codesFor = (day: TrainingDay) => protectedDays.includes(day.date) ? day.current_codes : day.planned_codes;
  const template = templates.find(item => item.name === selected);

  function saveTemplate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const days = week.days.map(day => !day.editable ? blankSlots() : periods.map((_, index) => {
      const code = drafts[day.date]?.[index] ?? codesFor(day)[index];
      return catalog.has(code) ? code : null;
    }) as SessionSlots);
    const next = [...templates.filter(item => item.name !== trimmed), { name: trimmed, days }];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setTemplates(next);
      setSelected(trimmed);
      setName("");
      setMessage("Modelo salvo neste computador.");
    } catch {
      setMessage("Não foi possível salvar o modelo neste computador.");
    }
  }

  function loadTemplate() {
    if (!template) return;
    const next = { ...drafts };
    week.days.forEach((day, index) => {
      if (!day.editable || protectedDays.includes(day.date)) return;
      const slots = [...(next[day.date] ?? blankSlots())] as SessionSlots;
      template.days[index].forEach((code, period) => {
        if (code !== null && catalog.has(code)) slots[period] = code;
      });
      if (slots.some(code => code !== null)) next[day.date] = slots;
    });
    setDrafts(next);
    setMessage("Modelo carregado na prévia. Confira as sessões antes de aplicar.");
  }

  function edit(day: string, period: number, raw: string) {
    const next = { ...drafts };
    const slots = [...(next[day] ?? blankSlots())] as SessionSlots;
    slots[period] = raw === "" ? null : Number(raw);
    if (slots.every(code => code === null)) delete next[day];
    else next[day] = slots;
    setDrafts(next);
  }

  return <section className="trainer-card trainer-plan">
    <div className="trainer-row trainer-between"><h2>Calendário de treino · {plan.weeks.length} semanas</h2>
      <select aria-label="Semana do plano" value={week.start} onChange={event => selectWeek(event.target.value)}>
        {plan.weeks.map(item => <option value={item.start} key={item.start}>Semana de {shortDate(item.start)} · {item.matches} jogo(s)</option>)}
      </select>
    </div>
    <div className="training-templates">
      <div className="trainer-row">
        <label>Modelo salvo <select value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="">{templates.length ? "Escolha um modelo" : "Nenhum modelo salvo"}</option>
          {templates.map(item => <option key={item.name}>{item.name}</option>)}
        </select></label>
        <button disabled={disabled || !template || !week.days.some(day => day.editable && !protectedDays.includes(day.date))}
          onClick={loadTemplate}>Carregar modelo</button>
      </div>
      <div className="trainer-row">
        <label>Nome do modelo <input value={name} maxLength={60} placeholder="Semana com dois jogos"
          onChange={event => setName(event.target.value)} /></label>
        <button disabled={disabled || !name.trim() || !week.days.some(day => day.editable)} onClick={saveTemplate}>
          {templates.some(item => item.name === name.trim()) ? "Atualizar modelo" : "Salvar como modelo"}
        </button>
      </div>
    </div>
    {message && <p className="muted" role="status">{message}</p>}
    <label className="trainer-check"><input type="checkbox" checked={week.protected} disabled={disabled || week.rest}
      onChange={event => protectWeek(week.start, event.target.checked)} /> Proteger esta semana</label>
    <p className="muted">{week.rest ? "Semana de férias preservada." : "O automático preserva os dias marcados. As sessões editadas só entram no jogo ao aplicar."}</p>
    <div className="trainer-table-scroll"><table className="grid" aria-label="Prévia editável do calendário">
      <thead><tr><th>Dia</th>{periods.map(period => <th key={period}>{period}</th>)}<th>Situação</th></tr></thead>
      <tbody>{week.days.map(day => {
        const protectedDay = protectedDays.includes(day.date);
        return <tr key={day.date}><td>{shortDate(day.date)}</td>
          {periods.map((period, index) => {
            const planned = codesFor(day)[index];
            const fallback = protectedDay ? day.current[index] : day.planned[index];
            const override = drafts[day.date]?.[index] ?? null;
            return <td key={period}>{!day.editable ? sessionName(fallback) : <select className={override === null ? "" : "training-session-edited"}
              aria-label={`${period} de ${shortDate(day.date)}`} value={override ?? ""} disabled={disabled}
              onChange={event => edit(day.date, index, event.target.value)}>
              <option value="">{sessionName(catalog.get(planned) ?? fallback)}</option>
              {plan.sessions.map(([code, label]) => <option key={code} value={code}>{sessionName(label)}</option>)}
            </select>}</td>;
          })}
          <td>{week.protected ? "Semana protegida" : day.editable
            ? <label className="training-day-toggle"><input type="checkbox" checked={protectedDay} disabled={disabled}
              aria-label={`Proteger dia ${shortDate(day.date)}`} onChange={event => protectDay(day.date, event.target.checked)} />
            {protectedDay ? "Dia protegido" : "Proteger dia"}</label> : "Preservado pelo FM"}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <div className="trainer-row trainer-between">
      <span className="muted">{Object.keys(drafts).length ? `${Object.keys(drafts).length} dia(s) com edição manual na prévia` : week.focus}</span>
      <button className="primary" disabled={disabled || !canApply} onClick={apply}>Aplicar treinos no FM</button>
    </div>
  </section>;
}

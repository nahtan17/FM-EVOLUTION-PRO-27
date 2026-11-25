import type { Strings } from "./en";

const n = (value: number) => value.toLocaleString("pt-BR");
const countChanges = (count: number) => count === 1 ? "1 alteração" : `${n(count)} alterações`;

export const jobsPt: Strings["jobs"] = {
  1: "Jogador", 2: "Preparador", 4: "Presidente do conselho", 6: "Diretor", 10: "Diretor de futebol",
  12: "Fisioterapeuta", 14: "Olheiro", 16: "Treinador", 20: "Auxiliar técnico", 22: "Preparador de bolas paradas",
  26: "Preparador físico", 34: "Preparador de goleiros", 38: "Médico-chefe", 40: "Chefe de ciência do esporte",
  44: "Olheiro-chefe", 46: "Médico", 48: "Cientista do esporte", 50: "Fisioterapeuta-chefe",
  58: "Analista de recrutamento", 60: "Analista de desempenho", 62: "Chefe de análise de desempenho",
  64: "Coordenador da base", 66: "Proprietário", 70: "Presidente", 86: "Gestor de empréstimos", 88: "Diretor técnico",
};

export const nationalPt: Strings["national"] = {
  nav: "Seleções", switchLabel: "Clubes ou seleções", search: "Buscar país por nome, código ou ID",
  summary: (total, shown) => `${n(total)} seleções${total > shown ? ` · primeiras ${n(shown)} por reputação` : ""}`,
  empty: (query, filtered) => query ? `Nenhuma seleção encontrada para “${query}”.` : filtered ? "Nenhuma seleção corresponde ao filtro." : "Nenhuma seleção encontrada.",
  women: "Feminina", columns: { name: "País", code: "Código", reputation: "Reputação", players: "Jogadores", uid: "ID" },
  filters: { kind: "Seleções", all: "Todas", men: "Masculinas", women: "Femininas" },
  womensTeam: "Seleção feminina", mensTeam: "Seleção masculina", reputationShort: "REP",
  reputationTitle: "Reputação da seleção principal (0 a 10.000)",
  teamKinds: { 0: "Principal", 9: "Sub-23", 10: "Sub-21", 18: "Sub-20", 11: "Sub-19", 12: "Sub-18" },
  teamType: (kind) => `Tipo ${kind}`, teamsLabel: "Equipes da seleção",
  teamReputation: (team) => `Reputação de ${team}`, teamReputationTitle: "Reputação desta equipe (0 a 10.000)",
  squadHeading: (team, count) => `${team} · ${n(count)} ${count === 1 ? "jogador" : "jogadores"}`,
  squadLabel: (team) => `Jogadores da seleção ${team}`,
  squadNote: "A ordem do elenco segue a do jogo. Convocações, capitania e contrato do treinador são consultados no jogo.",
  actionsHint: "As ações abrangem toda a seleção principal. Use o Histórico para desfazer.",
  noTeams: "O jogo não listou equipes para este país.", reading: "Carregando elenco…", noPlayers: "O jogo não listou jogadores para esta equipe.",
  unavailableTitle: "Seleções indisponíveis nesta versão do jogo",
  unavailableBuild: "O formato dos dados das seleções ainda não foi identificado nesta versão do jogo.",
  unavailableUnreadable: "O editor não conseguiu validar os dados das seleções nesta versão do jogo.",
};

export const changesPt: Strings["changes"] = {
  nav: "Histórico", title: "Histórico de alterações",
  hint: "As alterações mais recentes aparecem primeiro. Para desfazer, o jogo ainda precisa ter o valor gravado pelo editor.",
  earlierNote: (count, missing) => `${countChanges(count)} de sessões anteriores${missing ? ` · ${n(missing)} já não constavam no jogo` : ""}.`,
  earlierTag: "Anterior", earlierTitle: "Alteração registrada antes da última conexão",
  inGame: "No jogo", inGameTitle: "O valor constava no jogo quando os dados foram lidos.",
  notInGame: "Ausente no jogo", notInGameTitle: "O valor estava ausente quando os dados do jogo foram lidos.",
  historyOnly: "Histórico", historyOnlyTitle: "Registro de uma sessão anterior, disponível para consulta.",
  batchNotInGame: (count) => `${n(count)} ausentes no jogo`,
  clearHistory: "Limpar histórico", clearHistoryTitle: "Limpar o registro desta carreira. As alterações permanecem no jogo.",
  confirmClear: "Limpar o histórico desta carreira? As alterações permanecem no jogo e deixam de poder ser desfeitas pelo histórico.",
  keepHistory: "Manter histórico", clearConfirm: "Limpar", continueHint: "Avance o jogo para exibir a alteração no Football Manager.",
  swappedWith: (name) => `Troca com ${name}`, released: (name) => `${name} foi dispensado`, fee: (amount) => `Valor ${amount}`,
  arranged: (date) => `Transferência agendada para ${date}`, optionRemoved: (amount) => `Opção de compra removida (${amount})`,
  healed: (count) => count === 1 ? "1 lesão curada" : `${n(count)} lesões curadas`,
  lifted: (count) => count === 1 ? "1 suspensão removida" : `${n(count)} suspensões removidas`,
  keptPlaying: (date) => date ? `Aposentadoria de ${date} impedida` : "Vai continuar jogando",
  count: (total, undone) => countChanges(total) + (undone ? ` · ${n(undone)} desfeitas` : ""),
  empty: "Nenhuma alteração registrada. Edite os campos de um perfil ou use Editar em massa.",
  columns: { time: "Hora", name: "Nome", field: "Campo", change: "Alteração", status: "Status" },
  kinds: { player: "Jogador", staff: "Comissão técnica", club: "Clube", nationalTeam: "Seleção" },
  stored: (change) => `Valor armazenado ${change}`, undone: (time) => `Desfeita às ${time}`,
  undo: "Desfazer", undoTitle: (label) => `Restaurar o valor anterior de ${label}`,
  batch: "Edição em massa", batchCount: (total, remaining) => `${countChanges(total)} · ${n(remaining)} aplicadas`,
  showChanges: "Mostrar alterações", hideChanges: "Ocultar alterações", undoBatch: "Desfazer edição em massa",
  undoBatchTitle: (remaining) => `Restaurar os valores anteriores de ${countChanges(remaining)}`,
  pages: "Páginas do histórico", batchPages: "Páginas da edição em massa", previous: "Anterior", next: "Próxima",
  range: (first, last, total) => `${n(first)}–${n(last)} de ${n(total)}`,
  searchPlaceholder: "Buscar no histórico por nome, ID, campo ou clube", sessionGroup: "Sessão",
  sessions: { all: "Todas", this: "Esta sessão", earlier: "Sessões anteriores" },
  notUndone: "Só alterações aplicadas", notUndoneTitle: "Mostrar as alterações que ainda estão aplicadas",
  notInGameFilterTitle: "Mostrar alterações de sessões anteriores ausentes no jogo", clearFilter: "Limpar filtro",
  filteredCount: (matching, total, undone) => `${n(matching)} de ${countChanges(total)}${undone ? ` · ${n(undone)} desfeitas` : ""}`,
  batchMatching: (matching, total) => `${n(matching)} de ${n(total)} correspondem ao filtro`,
  noMatches: "Nenhuma alteração corresponde à busca e aos filtros.",
};

const entityNoun = { player: "jogadores", staff: "funcionários", club: "clubes" };

export const exportPt: Strings["export"] = {
  button: "Exportar",
  buttonTitle: {
    player: "Exportar os jogadores da busca para CSV ou JSON",
    staff: "Exportar os funcionários da busca para CSV ou JSON",
    club: "Exportar os clubes da busca para CSV ou JSON",
  },
  title: { player: "Exportar jogadores", staff: "Exportar funcionários", club: "Exportar clubes" },
  scope: (entity, count) => count
    ? `${n(count)} ${entityNoun[entity]} na ordem e com os filtros da lista.`
    : "Nenhum registro corresponde à busca e aos filtros.",
  formatLabel: "Formato",
  formats: { csv: "CSV separado por vírgula", csvSemicolon: "CSV separado por ponto e vírgula", json: "JSON" },
  formatHints: {
    csv: "Para a maioria das planilhas e scripts",
    csvSemicolon: "Para planilhas configuradas com vírgula como separador decimal",
    json: {
      player: "Posições, atributos e personalidade são agrupados por categoria",
      staff: "Atributos, personalidade e contrato são agrupados por categoria",
      club: "Torcida, infraestrutura, estádio e finanças são agrupados por categoria",
    },
  },
  contents: {
    player: "Inclui habilidade, posições, atributos de 1 a 20, personalidade, reputação, dados da seleção, contrato, cláusulas e data da carreira. Os valores monetários são exportados em libras.",
    staff: "Inclui cargo, clube, habilidade, atributos de 1 a 20, personalidade, reputação, salário, datas do contrato e data da carreira. Os valores monetários são exportados em libras.",
    club: "Inclui país, liga, reputação, fundação, torcida, infraestrutura, estádio e finanças disponíveis no jogo. Os valores monetários são exportados em libras.",
  },
  export: "Exportar", exporting: "Exportando…",
  done: (entity, count, file) => `Exportação de ${n(count)} ${entityNoun[entity]} concluída em ${file}`,
  folder: (folder) => `em ${folder}`,
  skipped: (_entity, count) => `${n(count)} registros mudaram durante a leitura e ficaram fora da exportação.`,
  open: "Abrir", openTitle: "Abrir o arquivo no aplicativo padrão",
  show: "Mostrar na pasta", showTitle: "Abrir a pasta do arquivo", close: "Fechar",
  changes: {
    buttonTitle: "Exportar para CSV as alterações mostradas no histórico",
    title: "Exportar alterações",
    scope: (count, filtering) => count
      ? `${countChanges(count)} ${filtering ? "da busca e dos filtros" : "de toda a carreira"}, da mais recente para a mais antiga.`
      : "Nenhuma alteração corresponde à busca e aos filtros.",
    contents: "Inclui data, nome, ID, campo, valores anterior e novo, edição em massa, sessão e informações de desfazer.",
    done: (count, file) => `Exportação de ${countChanges(count)} concluída em ${file}`,
  },
};

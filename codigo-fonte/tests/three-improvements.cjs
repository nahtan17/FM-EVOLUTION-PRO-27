// Interface regressions with simulated responses. Run from the source root with Playwright and a Chromium browser.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');

const app = resolve('app');
const url = 'http://127.0.0.1:15427';
const server = spawn(process.execPath, [app + '/node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
  '--port', '15427', '--strictPort'], { cwd: app });
let browser;
const reports = [];

async function run() {
  await new Promise((ready, failed) => {
    server.stdout.on('data', output => { if (output.toString().includes(url)) ready(); });
    server.once('exit', code => failed(Error('Vite exited: ' + code)));
    setTimeout(() => failed(Error('Vite unavailable')), 12000).unref();
  });
  browser = await chromium.launch({ executablePath: process.env.FM_CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);

  const groupPlayer = { uid: 90001, born: { year: 2009, month: 1, day: 1 } };
  const workspace = { label: 'Carreira simulada', session: 'mock-development', revision: 1, selections: {},
    settings: { lists: {}, groups: { Jovens: { players: [groupPlayer], rules: { multiplier: 2 }, profile: null } },
      profiles: {}, individuals: {} } };
  const players = [
    { summary: { uid: 90000, name: 'Bruno Silva', age: 16, club: 'Clube de demonstração' },
      condition: 8500, conditionRaw: 8500, sharpness: 8000, sharpnessRaw: 8000, fatigue: 30, injuriesAvailable: true, injuries: [] },
    { summary: { uid: 90001, name: 'Lucas Pereira', age: 17, club: 'Clube de demonstração' },
      condition: 8900, conditionRaw: 8900, sharpness: 7900, sharpnessRaw: 7900, fatigue: 10, injuriesAvailable: true, injuries: [] },
  ];
  let preview;
  const live = structuredClone(players);
  let expected;
  let writes = 0;
  let wholeClubReads = 0;
  const fitnessToken = 31;
  const batch = 40;
  const batchSession = 'mock-fitness';
  await page.exposeFunction('fixtureThreeImprovements', (command, args) => {
    switch (command) {
      case 'development_workspace':
        return workspace;
      case 'player_tools_list':
        if (args.wholeClub) {
          assert.equal(args.club, 27);
          assert.equal(args.query, undefined);
          wholeClubReads++;
        }
        return live.filter(row => !args.uids || args.uids.includes(row.summary.uid));
      case 'player_tools_preview': {
        assert.deepEqual(args.uids, expected.uids);
        assert.deepEqual(args.tool, { kind: 'fitnessAdvanced', conditionRaw: expected.condition,
          sharpness: expected.sharpness, club: 27 });
        const rows = live.filter(row => args.uids.includes(row.summary.uid)).map(row => {
          const fields = [
            ['condition', 'Condição física', expected.condition, row.conditionRaw, 0],
            ['match_sharpness', 'Ritmo de jogo', expected.sharpness, row.sharpnessRaw, 3500],
          ];
          const invalid = fields.filter(([, , next, , min]) => next !== null && (next < min || next > 10000));
          const reason = invalid.map(([, name, next]) => `${name}: ${next} fora da faixa de gravação validada.`).join(' ');
          const changes = invalid.length ? [] : fields.filter(([, , next, old]) => next !== null && next !== old)
            .map(([field, , next, old]) => ({ field, old, new: next }));
          return { uid: row.summary.uid, name: row.summary.name, club: row.summary.club,
            status: invalid.length ? 'Bloqueado' : changes.length ? 'Pronto' : 'Sem alteração', changes, reason };
        });
        preview = { token: fitnessToken, rows };
        return preview;
      }
      case 'player_tools_apply':
        assert.equal(args.token, fitnessToken);
        assert(preview.rows.every(row => row.status === 'Pronto'));
        writes++;
        return preview.rows.map(row => {
          const item = live.find(item => item.summary.uid === row.uid);
          for (const change of row.changes) {
            if (change.field === 'condition') item.condition = item.conditionRaw = change.new;
            else item.sharpness = item.sharpnessRaw = change.new;
          }
          return { ...row, status: 'Aplicado e relido', batch, batchSession };
        });
      case 'player_tools_progress':
        return null;
      case 'undo_batch':
        assert.deepEqual(args, { batch, session: batchSession });
        for (const item of live) Object.assign(item, players.find(row => row.summary.uid === item.summary.uid));
        return { undone: preview.rows.flatMap(row => row.changes).length, failed: [] };
      default:
        throw Error('Unexpected fixture command: ' + command);
    }
  });
  await page.route('**/src/api.ts*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const api = 'async function call(command, args) {';
    assert(body.includes(api));
    await route.fulfill({ response, body: body.replace(api, api +
      '\nif (command === "development_workspace" || command.startsWith("player_tools_") || (command === "undo_batch" && args?.session === "mock-fitness"))' +
      ' return window.fixtureThreeImprovements(command, args);') });
  });

  await page.goto(url);
  await page.getByRole('button', { name: 'Carregar jogo', exact: true }).click();
  await page.getByRole('button', { name: 'Treino', exact: true }).click();
  const development = page.getByRole('tab', { name: 'Desenvolvimento', exact: true });
  await development.click();
  const panel = page.getByRole('region', { name: 'Desenvolvimento dos jogadores' });
  const option = panel.getByRole('checkbox', { name: 'Crescimento semanal garantido', exact: true });
  const multiplier = panel.getByRole('spinbutton', { name: 'Multiplicador (1× a 100×)' });
  const review = panel.getByRole('table', { name: 'Ganhos de desenvolvimento' });
  const bruno = review.getByRole('row').filter({ hasText: 'Bruno Silva' });
  const lucas = review.getByRole('row').filter({ hasText: 'Lucas Pereira' });
  assert.equal(await option.isChecked(), false);
  await panel.getByRole('button', { name: 'Desmarcar todos' }).click();
  await panel.getByRole('checkbox', { name: 'Selecionar Bruno Silva', exact: true }).check();
  await panel.getByRole('checkbox', { name: 'Selecionar Lucas Pereira', exact: true }).check();
  await option.check();
  for (const factor of [1, 2, 5, 10]) {
    await multiplier.fill(String(factor));
    await panel.getByRole('button', { name: 'Aplicar aos selecionados' }).click();
    await bruno.getByText(`95 → ${95 + factor} / 150`, { exact: true }).waitFor();
    await lucas.getByText(factor === 1 ? '97 / 151' : `97 → ${96 + factor} / 151`, { exact: true }).waitFor();
    assert.equal(await review.getByRole('row').count(), 3);
  }
  reports.push('1×, 2×, 5× e 10×, seleção manual e ganho natural no diagnóstico');

  await panel.getByRole('tab', { name: 'Grupos, perfis e listas' }).click();
  await panel.getByRole('button', { name: 'Usar no painel 5×' }).click();
  assert.equal(await panel.getByRole('checkbox', { name: 'Selecionar Bruno Silva', exact: true }).isChecked(), false);
  assert.equal(await panel.getByRole('checkbox', { name: 'Selecionar Lucas Pereira', exact: true }).isChecked(), true);
  await panel.getByRole('button', { name: 'Voltar ao padrão (1×)' }).click();
  await panel.getByText('1× · Evolução padrão do FM.').waitFor();
  reports.push('Seleção de grupo existente e parada explícita em 1×');

  await page.getByRole('tab', { name: 'Elenco', exact: true }).click();
  const fitness = page.getByRole('region', { name: 'Central de condição física' });
  const mode = fitness.getByLabel('Modo de condição física');
  assert.equal(await mode.inputValue(), 'normal');
  assert.equal(await fitness.locator('option[value="tireless"]').evaluate(option => option.disabled), true);
  await mode.selectOption('advanced');
  const condition = fitness.getByRole('combobox', { name: "Condição física (valor bruto)" });
  const sharpness = fitness.getByRole('combobox', { name: "Ritmo de jogo (valor bruto)" });
  const list = fitness.getByRole('table', { name: 'Jogadores para edição' });
  const brunoPhysical = list.getByRole('row').filter({ hasText: 'Bruno Silva' });
  const brunoPick = fitness.getByRole('checkbox', { name: 'Selecionar Bruno Silva', exact: true });
  const makePreview = fitness.getByRole('button', { name: 'Conferir alterações', exact: true });
  const apply = fitness.getByRole('button', { name: 'Aplicar alterações conferidas', exact: true });
  const restore = fitness.getByRole('button', { name: 'Restaurar valores anteriores', exact: true });
  const fitnessPreview = fitness.getByRole('table', { name: 'Prévia do lote' });
  await brunoPhysical.getByRole('cell', { name: '8500', exact: true }).waitFor();
  await brunoPhysical.getByRole('cell', { name: '8000', exact: true }).waitFor();
  await fitness.getByRole('button', { name: 'Carregar e selecionar elenco inteiro' }).click();
  await fitness.getByText('2 selecionado(s)', { exact: true }).waitFor();
  assert.equal(wholeClubReads, 1);
  expected = { uids: [90000, 90001], condition: 10000, sharpness: 10000 };
  await sharpness.selectOption('10000');
  await makePreview.click();
  await fitnessPreview.getByText('8500 (85%)', { exact: true }).waitFor();
  assert.equal(await fitnessPreview.getByText('10000 (100%)', { exact: true }).count(), 4);
  await apply.click();
  await fitness.getByText('2 aplicado(s) de 2 selecionado(s).').waitFor();
  await brunoPhysical.getByRole('cell', { name: '10000', exact: true }).nth(1).waitFor();
  await restore.click();
  await fitness.getByText('4 campo(s) restaurado(s) · 0 recusado(s).').waitFor();
  await brunoPhysical.getByRole('cell', { name: '8500', exact: true }).waitFor();
  reports.push('10000/10000: prévia, aplicação em elenco, releitura e restauração simuladas');

  await fitness.getByRole('button', { name: 'Limpar seleção' }).click();
  await brunoPick.check();
  expected = { uids: [90000], condition: 10000, sharpness: 9301 };
  await sharpness.selectOption('custom');
  const rawSharpness = fitness.getByLabel('Ritmo de jogo (valor bruto) personalizado', { exact: true });
  await rawSharpness.fill('9301');
  await makePreview.click();
  await fitnessPreview.getByText('9301 (93,01%)', { exact: true }).waitFor();
  await apply.click();
  await fitness.getByText('1 aplicado(s) de 1 selecionado(s).').waitFor();
  await brunoPhysical.getByRole('cell', { name: '9301', exact: true }).waitFor();
  await restore.click();
  await fitness.getByText('2 campo(s) restaurado(s) · 0 recusado(s).').waitFor();

  expected = { uids: [90000], condition: null, sharpness: 9301 };
  await condition.selectOption('keep');
  await makePreview.click();
  await fitnessPreview.getByText('9301 (93,01%)', { exact: true }).waitFor();
  assert.equal(await fitnessPreview.getByRole('row').count(), 2);
  await apply.click();
  await fitness.getByText('1 aplicado(s) de 1 selecionado(s).').waitFor();
  await brunoPhysical.getByRole('cell', { name: '8500', exact: true }).waitFor();
  await restore.click();
  await fitness.getByText('1 campo(s) restaurado(s) · 0 recusado(s).').waitFor();
  reports.push('10000/9301 e manter/9301: gravação individual simulada e independência dos campos');

  for (const [physicalRaw, sharpnessRaw] of [[12749, 12749], [12749, 10000], [10000, 12749], [12749, null], [null, 12749], [12000, 12479]]) {
    expected = { uids: [90000], condition: physicalRaw, sharpness: sharpnessRaw };
    await condition.selectOption(String(physicalRaw ?? 'keep'));
    await sharpness.selectOption(String(sharpnessRaw ?? 'keep'));
    await makePreview.click();
    await fitnessPreview.getByText('Bloqueado', { exact: false }).waitFor();
    if (physicalRaw > 10000) await fitnessPreview.getByText(`Condição física: ${physicalRaw} fora`, { exact: false }).waitFor();
    if (sharpnessRaw > 10000) await fitnessPreview.getByText(`Ritmo de jogo: ${sharpnessRaw} fora`, { exact: false }).waitFor();
    assert.equal(await apply.isDisabled(), true);
    assert.equal(writes, 3);
    reports.push(`${physicalRaw ?? 'manter'}/${sharpnessRaw ?? 'manter'}: prévia bloqueou aplicação sem alterar valores`);
  }

  await condition.selectOption('keep');
  await sharpness.selectOption('custom');
  await rawSharpness.fill('15001');
  assert.equal(await makePreview.isDisabled(), true);
  assert.equal(writes, 3);
  reports.push('15001 personalizado: limite do formulário respeitado');

  await page.getByRole('button', { name: 'Países', exact: true }).click();
  const countries = page.locator('table.national-grid');
  const countryWorkspace = page.locator('.workspace').filter({ has: countries });
  const countrySearch = page.getByPlaceholder('Buscar país por nome, código ou ID');
  await countries.locator('tbody tr').first().waitFor();
  const reputations = (await countries.locator('tbody .rep').allTextContents()).map(text => Number(text.replace(/\D/g, '')));
  assert.deepEqual(reputations, [...reputations].sort((a, b) => b - a));
  await countryWorkspace.locator('.filter-toggle').click();
  const countryFilter = countryWorkspace.getByRole('combobox', { name: 'Seleções' });
  await countryFilter.selectOption('men');
  await countrySearch.fill('BRA');
  const country = countries.getByRole('cell', { name: /^(Brasil|Brazil)$/ });
  await country.click();
  const countryProfile = countryWorkspace.getByRole('region', { name: /^(Brasil|Brazil)$/ });
  const entityTabs = page.getByRole('navigation', { name: 'Entidades abertas' });
  const brazilTab = entityTabs.getByRole('button', { name: /^(Brasil|Brazil)$/ });
  await countryProfile.locator('table.squad-grid tbody tr').first().waitFor();
  assert.equal(await countries.isVisible(), false);
  assert.equal(await brazilTab.getAttribute('aria-pressed'), 'true');
  assert(Math.abs((await countryProfile.boundingBox()).width - (await countryWorkspace.boundingBox()).width) <= 1);
  const reputation = countryProfile.locator('.profile-head').locator('.rep, [data-field="reputation"]');
  await reputation.waitFor();
  assert(await reputation.evaluate(element => Number((element.value ?? element.textContent).replace(/\D/g, '')) > 0));
  assert.equal(await countryProfile.locator('.squad-buttons button').count(), 3);
  const categories = countryProfile.getByRole('group', { name: 'Equipes da seleção' });
  for (const category of ['Principal', 'Sub-23', 'Sub-21', 'Sub-20', 'Sub-19', 'Sub-18']) {
    const button = categories.getByRole('button', { name: category, exact: true });
    await button.click();
    await countryProfile.getByRole('button', { name: category, exact: true, pressed: true }).waitFor();
    assert.equal(await countryProfile.getByRole('button', { name: 'Maximizar entendimento tático — 100' }).count(), 0);
  }
  const previewTactics = countryProfile.getByRole('button', { name: 'Ver prévia da tática ativa', exact: true });
  const maxTactics = countryProfile.getByRole('button', { name: 'Maximizar entendimento tático', exact: true });
  const tacticsTable = countryProfile.getByRole('table', { name: 'Prévia de entendimento tático da seleção' });
  await previewTactics.click();
  await countryProfile.getByText('Nenhuma tática ativa encontrada para esta categoria.').waitFor();
  assert.equal(await maxTactics.count(), 0);

  await categories.getByRole('button', { name: 'Principal', exact: true }).click();
  await categories.getByRole('button', { name: 'Principal', exact: true, pressed: true }).waitFor();
  await countryProfile.getByRole('button', { name: 'Preparar maximização a 100%', exact: true }).click();
  await tacticsTable.waitFor();
  const firstPlayer = tacticsTable.locator('tbody tr').first();
  await firstPlayer.getByText(/83[,.]75.*100%/).waitFor();
  assert.equal(await firstPlayer.locator('td').nth(3).innerText(), '—');
  const members = tacticsTable.getByRole('checkbox');
  for (const checkbox of (await members.all()).slice(1)) await checkbox.uncheck();
  const firstBox = members.first();
  await firstBox.uncheck();
  assert.equal(await maxTactics.isDisabled(), true);
  await firstBox.check();

  page.once('dialog', (dialog) => void dialog.dismiss());
  await maxTactics.click();
  await firstPlayer.getByText(/83[,.]75.*100%/).waitFor();

  page.once('dialog', (dialog) => void dialog.accept());
  await maxTactics.click();
  await countryProfile.getByText('Exposição tática atualizada para 1 convocado(s).').waitFor();
  const log = await page.evaluate(async () => {
    const { mockInvoke } = await import('/src/dev/mock.ts');
    return await mockInvoke('change_log');
  });
  assert.equal(log.filter(change => change.field === 'national_tactics.exposure').length, 1);
  await previewTactics.click();
  await firstPlayer.locator('td').nth(1).getByText('100%', { exact: true }).waitFor();
  assert.equal(await firstPlayer.locator('td').nth(3).innerText(), '—');

  const tacticsRegion = countryProfile.getByRole('region', { name: 'Entendimento tático · Principal' });
  await tacticsRegion.getByRole('button', { name: /Desfazer/ }).click();
  await previewTactics.click();
  await firstPlayer.getByText(/83[,.]75.*100%/).waitFor();
  const areaInputs = tacticsRegion.getByRole('spinbutton');
  await areaInputs.first().fill('101');
  assert.equal(await previewTactics.isDisabled(), true);
  for (const input of (await areaInputs.all()).slice(1)) await input.fill('');
  await areaInputs.first().fill('75');
  await previewTactics.click();
  await firstPlayer.getByText(/83[,.]75.*75%/).waitFor();
  for (const checkbox of (await members.all()).slice(1)) await checkbox.uncheck();
  page.once('dialog', (dialog) => void dialog.accept());
  await tacticsRegion.getByRole('button', { name: 'Aplicar ajustes por área' }).click();
  await countryProfile.getByText('Exposição tática atualizada para 1 convocado(s).').waitFor();
  await previewTactics.click();
  assert.equal(await firstPlayer.locator('td').nth(1).innerText(), '75%');
  assert.equal(await firstPlayer.locator('td').nth(2).innerText(), '71%');
  await tacticsRegion.getByRole('button', { name: /Desfazer/ }).click();
  await previewTactics.click();
  await firstPlayer.getByText(/83[,.]75.*75%/).waitFor();
  await categories.getByRole('button', { name: 'Sub-18', exact: true }).click();
  await categories.getByRole('button', { name: 'Sub-18', exact: true, pressed: true }).waitFor();
  reports.push('Tática nacional: prévia, categoria sem tática, seleção de convocado, cancelamento, aplicação, Histórico e desfazer');

  await countryProfile.getByRole('button', { name: 'Voltar', exact: true }).click();
  await countries.waitFor();
  assert.equal(await countrySearch.inputValue(), 'BRA');
  assert.equal(await countryFilter.inputValue(), 'men');
  assert.equal(await brazilTab.getAttribute('aria-pressed'), 'false');
  await countrySearch.fill('GER');
  await countries.getByRole('cell', { name: /^(Alemanha|Germany)$/ }).click();
  await countryWorkspace.getByRole('region', { name: /^(Alemanha|Germany)$/ }).waitFor();
  await brazilTab.click();
  await categories.getByRole('button', { name: 'Sub-18', exact: true, pressed: true }).waitFor();
  await page.keyboard.press('Escape');
  await countries.waitFor();
  assert.equal(await countrySearch.inputValue(), 'GER');
  await entityTabs.getByRole('button', { name: /^Fechar (Brasil|Brazil)$/ }).click();
  assert.equal(await brazilTab.count(), 0);
  reports.push('Seleções em abas de largura total, busca e filtro preservados, categorias, convocados e ações disponíveis');

  await page.getByRole('button', { name: 'Clubes', exact: true }).click();
  await page.locator('table.club-grid:not(.national-grid):visible tbody tr').first().click();
  await page.getByRole('tab', { name: 'Entendimento tático', exact: true }).click();
  await page.getByRole('button', { name: 'Melhorar entendimento tático', exact: true }).waitFor();
  reports.push('Ação de entendimento tático disponível nos clubes');

  const maintenance = page.locator('.club-care:visible');
  const maintain = maintenance.getByRole('checkbox', { name: 'Manter melhorias do elenco' });
  const globalCondition = maintenance.getByRole('spinbutton', { name: 'Condição física (valor bruto)' });
  const globalSharpness = maintenance.getByRole('spinbutton', { name: 'Ritmo de jogo (valor bruto)' });
  const applyFitness = maintenance.getByRole('button', { name: 'Aplicar valores à manutenção' });
  const clubUid = await page.evaluate(async () => {
    const { mockInvoke } = await import('/src/dev/mock.ts');
    const { rows } = await mockInvoke('search_clubs', { query: '', limit: 200 });
    return rows[0].uid;
  });
  const waitForFitness = (condition, sharpness) => page.waitForFunction(async ({ clubUid, condition, sharpness }) => {
    const { mockInvoke } = await import('/src/dev/mock.ts');
    const teams = await mockInvoke('club_squads', { uid: clubUid });
    const players = teams.find(team => team.index === 0).players;
    return players.length > 1 && players.every(player => player.condition === condition && player.matchSharpness === sharpness);
  }, { clubUid, condition, sharpness });

  assert.equal(await globalCondition.inputValue(), '10000');
  await globalCondition.fill('12750');
  assert.equal(await maintain.isDisabled(), true);
  await globalCondition.fill('5000');
  await maintain.click();
  await maintain.and(page.locator('input:checked')).waitFor();
  await waitForFitness(5000, 10000);
  await globalCondition.fill('12749');
  await globalSharpness.fill('9301');
  await applyFitness.click();
  await waitForFitness(12749, 9301);

  // A fresh value from the game must be put back at the next maintenance check.
  await page.evaluate(async (uid) => {
    const { mockInvoke } = await import('/src/dev/mock.ts');
    const [{ players }] = await mockInvoke('club_squads', { uid });
    await mockInvoke('apply_edits', { entity: 'player', uid: players[0].uid, edits: [{ field: 'condition', value: 7400 }] });
  }, clubUid);
  await waitForFitness(12749, 9301);
  await page.getByRole('tab', { name: 'Plantéis', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.profile:not([hidden]) .squad-tab .club-care input[type="number"]')?.value === '12749');
  await page.waitForFunction(() => document.querySelectorAll('.profile:not([hidden]) .squad-tab .club-care input[type="number"]')[1]?.value === '9301');
  await maintain.click();
  await maintain.and(page.locator('input:enabled:not(:checked)')).waitFor();
  assert.equal(await maintain.isChecked(), false);
  reports.push('Manutenção global: aplicação em todo o plantel, 5000 e 12749, ritmo independente e reaplicação periódica');

  const intake = await page.evaluate(async uid => {
    const { mockInvoke } = await import('/src/dev/mock.ts');
    const result = await mockInvoke('youth_intakes', { club: uid });
    const [intake] = result.intakes;
    const [preserved, raised, conflicted] = intake.players.map(item => item.player);
    await mockInvoke('apply_edits', { entity: 'player', uid: preserved.uid, edits: [{ field: 'potential_ability', value: 185 }] });
    for (const player of [raised, conflicted]) {
      await mockInvoke('apply_edits', { entity: 'player', uid: player.uid, edits: [{ field: 'potential_ability', value: 130 }] });
    }
    return { preserved, raised, conflicted, uids: intake.players.map(item => item.player.uid) };
  }, clubUid);
  const readAbilities = () => page.evaluate(async uids => {
    const { mockInvoke } = await import('/src/dev/mock.ts');
    return Promise.all(uids.map(async uid => {
      const { current_ability, potential_ability } = await mockInvoke('read_values', { entity: 'player', uid });
      return { uid, ca: current_ability, pa: potential_ability };
    }));
  }, intake.uids);
  const beforeGolden = await readAbilities();
  await page.getByRole('tab', { name: 'Geração de Ouro', exact: true }).click();
  const generation = page.getByRole('tabpanel', { name: 'Geração de Ouro' });
  const minimum = generation.getByRole('spinbutton', { name: 'PA mínimo' });
  const plan = generation.getByRole('button', { name: 'Gerar prévia de PA' });
  await minimum.fill('201');
  assert.equal(await plan.isDisabled(), true);
  await minimum.fill('160');
  await plan.click();
  const goldenPreview = generation.getByRole('table', { name: 'Prévia de PA da fornada' });
  await goldenPreview.getByRole('row').filter({ hasText: intake.preserved.name }).getByText('Sem alteração', { exact: true }).waitFor();
  await goldenPreview.getByRole('row').filter({ hasText: intake.raised.name }).getByRole('cell', { name: '160', exact: true }).waitFor();
  assert.deepEqual(await readAbilities(), beforeGolden);
  await page.evaluate(async uid => {
    const { mockInvoke } = await import('/src/dev/mock.ts');
    await mockInvoke('apply_edits', { entity: 'player', uid, edits: [{ field: 'potential_ability', value: 140 }] });
  }, intake.conflicted.uid);
  await generation.getByRole('button', { name: 'Confirmar e aplicar PA' }).click();
  await generation.getByText(/Lote registrado no Histórico/).waitFor();
  await generation.getByRole('list', { name: 'Alterações recusadas' }).getByText(intake.conflicted.name, { exact: false }).waitFor();
  const afterGolden = await readAbilities();
  assert.equal(afterGolden.find(row => row.uid === intake.raised.uid).pa, 160);
  assert.equal(afterGolden.find(row => row.uid === intake.preserved.uid).pa, 185);
  assert.equal(afterGolden.find(row => row.uid === intake.conflicted.uid).pa, 140);
  assert.deepEqual(afterGolden.map(row => row.ca), beforeGolden.map(row => row.ca));
  await page.getByRole('button', { name: /^Histórico(?:\s|$)/ }).click();
  const goldenBatch = page.locator('.batch-row').first();
  await goldenBatch.getByRole('button', { name: 'Mostrar alterações', exact: true }).click();
  await page.getByText('Geração de Ouro · Gravação confirmada', { exact: true }).first().waitFor();
  page.once('dialog', dialog => dialog.accept());
  await goldenBatch.getByRole('button', { name: 'Desfazer edição em massa', exact: true }).click();
  await page.locator('.batch-row.undone').first().waitFor();
  assert.deepEqual(await readAbilities(), beforeGolden.map(row => row.uid === intake.conflicted.uid ? { ...row, pa: 140 } : row));
  reports.push('Geração de Ouro: prévia sem edição, PA maior preservado, conflito recusado e lote desfeito no Histórico');

  await page.getByRole('button', { name: 'Jogadores', exact: true }).click();
  await page.locator('.workspace:not(.inactive) .players tbody tr').first().click();
  await page.getByRole('tab', { name: 'Condição e lesões', exact: true }).click();
  const rawFitness = page.getByRole('checkbox', { name: 'Editar condição e ritmo em valores brutos' });
  const playerCondition = page.locator('.profile:visible [data-field="condition"]');
  const playerSharpness = page.locator('.profile:visible [data-field="match_sharpness"]');
  await rawFitness.waitFor();
  assert.equal(await rawFitness.isChecked(), false);
  assert.equal(await playerCondition.getAttribute('max'), '100');
  await rawFitness.check();
  const originalCondition = await playerCondition.inputValue();
  const originalSharpness = await playerSharpness.inputValue();
  assert(Number(originalCondition) > 100);
  assert.equal(await playerCondition.getAttribute('max'), '12749');
  assert.equal(await playerSharpness.getAttribute('min'), '3500');
  await playerCondition.fill('12750');
  assert.equal(await playerCondition.getAttribute('aria-invalid'), 'true');
  await playerCondition.fill('12749');
  await playerSharpness.fill('9301');
  assert.equal(await rawFitness.isDisabled(), true);
  await page.keyboard.press('Control+s');
  await rawFitness.and(page.locator('input:enabled')).waitFor();
  assert.equal(await playerCondition.inputValue(), '12749');
  assert.equal(await playerSharpness.inputValue(), '9301');
  await rawFitness.uncheck();
  assert.equal(await playerCondition.getAttribute('max'), '100');
  assert.equal(await playerCondition.inputValue(), '127');
  await page.getByRole('button', { name: /^Histórico(?:\s|$)/ }).click();
  for (const name of ['Condição física', 'Ritmo de jogo']) {
    const change = page.getByRole('row').filter({ hasText: name }).first();
    await change.getByRole('button', { name: 'Desfazer', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Jogadores', exact: true }).click();
  await page.locator('.workspace:not(.inactive) .players tbody tr').first().click();
  await rawFitness.check();
  assert.equal(await playerCondition.inputValue(), originalCondition);
  assert.equal(await playerSharpness.inputValue(), originalSharpness);
  reports.push('Ficha do jogador: digitação em valores brutos, gravação independente e restauração pelo Histórico');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Comissão técnica', exact: true }).first().click();
  await page.locator('.workspace:not(.inactive) .staff-grid tbody tr').first().click();
  const presets = page.getByRole('group', { name: 'Predefinições de atributos da comissão' });
  await presets.getByRole('button', { name: 'Definir atributos em 14' }).click();
  const staffAttack = page.locator('input[data-field="attribute.attacking"]:visible');
  assert.equal(await staffAttack.inputValue(), '14');
  for (const key of ['coaching_player', 'dirtiness_allowance', 'versatility', 'tactical_attacking', 'width',
    'buying_players', 'squad_rotation', 'judging_team_data', 'presenting_data', 'business', 'resources']) {
    assert.equal(await page.locator(`input[data-field="attribute.${key}"]:visible`).inputValue(), '14', key);
  }
  await presets.getByRole('button', { name: 'Definir atributos em 5' }).click();
  assert.equal(await staffAttack.inputValue(), '5');
  const staffFieldKeys = await page.evaluate(async () => {
    const { mockInvoke } = await import('/src/dev/mock.ts');
    return mockInvoke('edit_fields', { entity: 'staff' });
  });
  assert(staffFieldKeys.some(field => field.key === 'attribute.presenting_data' && field.max === 100));
  assert(staffFieldKeys.some(field => field.key === 'attribute.width' && field.max === 20));
  reports.push('Comissão técnica: novos grupos, campos e predefinições nas duas escalas');

  assert.deepEqual(errors, []);
  for (const report of reports) console.log(report);
}

run().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await browser?.close(); server.kill(); });

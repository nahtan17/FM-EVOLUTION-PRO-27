const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const {resolve} = require('node:path');
const app = resolve(__dirname, '../../app');
const origin = 'http://127.0.0.1:15437';
const server = spawn(process.execPath, [app+'/node_modules/vite/bin/vite.js', '--host','127.0.0.1','--port','15437'], {cwd:app,stdio:['ignore','pipe','pipe']});
const results = [];
let browser, page;
(async () => {
  await new Promise((resolve, reject) => {
    server.stdout.on('data', out => { if (out.toString().includes(origin)) resolve(); });
    server.once('exit', code => reject(Error('Vite exited ' + code)));
    setTimeout(() => reject(Error('Vite timeout')), 15000).unref();
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.UI_CHROMIUM_BIN });
  page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
  page.setDefaultTimeout(9000);
  const crash = [];
  page.on('pageerror', err => crash.push(err.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    const today = { day: 7, month: 2, year: 2027 };
    const later = { day: 14, month: 2, year: 2027 };
    const initial = { groups: {}, lists: {}, profiles: {}, individuals: {} };
    let revision = 0, label = null, settings = initial, selection = {};
    const players = [
      { uid: 90000, name:"Bruno Silva", club:"Clube de demonstração", age:17, born:{day:10,month:7,year:2009}, ability:95, potential:155, positions:["gk"] },
      { uid: 90001, name:"Lucas Pereira", club:"Clube de demonstração", age:30, born:{day:3,month:1,year:1997}, ability:100, potential:140, positions:["mc"] },
      { uid: 90002, name:"Rafael Costa", club:"Clube de demonstração", age:20, born:{day:3,month:1,year:2007}, ability:160, potential:160, positions:["st"] },
    ].map(row=>({...row, rawPotential:row.potential, eligible:row.ability<row.potential, reason:row.ability===row.potential?"Potencial atingido":null, focus:["attribute.passing"]}));
    let report = [], token = 0, review = [], active = false, changes = [];
    let activeCohesion = 68;
    let watch = false;
    let dates = [today];
    let financeRows = [];
    window.__suite = {
      requests: [],
      advanceWatch() {dates = [today,later];},
      handle(command,args = {}) {
        const names = [
          'development_preview','development_workspace','development_settings','development_status','development_set',
          'development_snapshots','development_export','player_tools_list','player_tools_preview','player_tools_apply',
          'player_tools_progress','club_tactical_summary','club_cohesion_watch','club_finance_history','team_action',
        ];
        if (!names.includes(command)) return null;
        this.requests.push([command,structuredClone(args)]);
        switch(command) {
          case 'development_preview': return { value:players };
          case 'development_workspace':
            if(args.name) label=args.name;
            return {value:{label,session:"fixture",revision,settings,selections:selection}};
          case 'development_settings':
            settings=args.settings;revision++;
            return {value:{label,session:"fixture",revision,settings,selections:selection}};
          case 'development_set':
            active=args.multiplier>1;
            selection={ "27":players.filter(row=>args.selectedPlayers?.includes(row.uid)).map(({uid,born})=>({uid,born})) };
            report=players.filter(row=>args.selectedPlayers?.includes(row.uid)).map((row,i)=>({
              uid:row.uid,name:row.name,ca:row.ability+(i===0?4:0),pa:row.potential,natural:i===0?1:0,bonus:i===0?4:0,
              multiplier:args.multiplier, group:null, week:{day:8,month:2,year:2027},
              attemptedAt:i===0?10000000:null, status:i===0?"Evolução aplicada":"Falha de leitura",reason:i===0?null:"Falha simulada",
              attributes:[],
            }));
            return this.handle("development_status");
          case 'development_status': return {value:{active,club:27,team:null,multiplier:5,weekly:true,tracked:report.length,
            boosted:report.length?1:0,processed:report.length,failures:report.length>1?1:0,unchanged:0,meanBonus:2,
            weeklyLimit:null,lastDate:later,lastWeek:{day:8,month:2,year:2027},event:active?1:0,reportDate:later,report,error:null}};
          case 'development_snapshots': return { value:players.filter(row=>args.uids.includes(row.uid)).flatMap((row,index)=>
            [today,later].map((date,i)=>({player:{uid:row.uid,born:row.born},name:row.name,club:row.club,date,
              readAt:i,ability:row.ability+i*(index+1),potential:row.potential,attributes:{passing:10+i},source:"Leitura do FM"}))) };
          case 'development_export': return {value:"desenvolvimento-teste.json"};
          case 'player_tools_list': return {value:players.filter(row=>!args.query||row.name.toLowerCase().includes(args.query.toLowerCase())||
              String(row.uid)===args.query).map(row=>({
              summary:{uid:row.uid,name:row.name,club:row.club,age:row.age,currentAbility:row.ability,potentialAbility:row.potential,
                dateOfBirth:row.born,positions:row.positions},
              condition:9000,sharpness:8000,fatigue:-300,injuriesAvailable:true,injuries:[],
              wage:7000,expires:{day:30,month:6,year:2029},contractType:1,loan:false,marketValue:17_000_000,
              reason:null,attributes:{passing:14},
          }))};
          case 'player_tools_preview':
            token++;
            changes=({evolve:[{field:"current_ability",old:95,new:100}],
              fitness:[{field:"condition",old:9000,new:9700}],
              contract:[{field:"contract.wage",old:7000,new:7700}],
              copy:[{field:"attribute.passing",old:45,new:65}],
            })[args.tool.kind];
            review=players.filter(row=>args.uids.includes(row.uid)).map((row,i)=>({
              uid:row.uid,name:row.name,club:row.club,status:i===0?"Pronto":"Bloqueado",reason:i===0?null:"Proteção de teste",
              changes:i===0?changes:[],
            }));
            return {value:{token,rows:review}};
          case 'player_tools_apply': return {value:review.map(row=>({...row,status:row.status==="Pronto"?"Aplicado e relido":row.status}))};
          case 'player_tools_progress': return {value:null};
          case 'club_cohesion_watch':
            if(typeof args.enabled === "boolean") watch = args.enabled;
            return {value:{enabled:watch,error:null,samples:watch?dates.map((date,i)=>({date,week:date,cohesion:68+i,
              measured:3,players:3})):[]}};
          case 'club_finance_history':
            if(args.capture === true) {
              if(args.profile !== label) throw Error("Unexpected profile");
              financeRows = [{date:today,balance:125000,transferBudget:50000,wageBudget:10000}];
            }
            return {value:{profile:label,rows:financeRows}};
          case 'club_tactical_summary': {
            const members=players.map(row=>({uid:row.uid,name:row.name,cohesion:row.uid===90000?activeCohesion:70,reason:null,tacticalRecord:true}));
            return {value:{session:"fixture",date:today,teams:[{index:0,kind:0,ageLimit:null,record:Array(8).fill(65),
              training:Array(8).fill(60),knownPlayers:3,players:3,members,cohesion:69}]}};
          }
          case 'team_action':
            if (args.cohesionLevel) activeCohesion=args.cohesionLevel;
            return {value:{batch:33,applied:1,failed:[]}};
        }
      },
    };
  });
  await page.route('**/src/api.ts', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const pattern = /async function call\(command, args\)\s*\{/;
    assert(pattern.test(body));
    await route.fulfill({response,body:body.replace(pattern, match => match + '\nconst result = window.__suite.handle(command, args); if (result !== null) return result.value;\n')});
  });
  await page.goto(origin);
  await page.getByRole('button',{name:'Carregar jogo',exact:true}).click();
  await page.getByRole('button',{name:'Treino',exact:true}).click();
  const training=page.locator('.trainer-workspace:not(.inactive)');
  await training.getByRole('tab',{name:'Desenvolvimento',exact:true}).click();
  assert.equal(await training.getByLabel('Multiplicador (1× a 100×)',{exact:true}).inputValue(),'5');
  await training.getByRole('checkbox',{name:'Verificação semanal'}).waitFor();
  assert(await training.getByRole('checkbox',{name:'Verificação semanal'}).isChecked());
  await training.getByLabel('Idade máxima para seleção automática').fill('18');
  const older = training.getByRole('checkbox',{name:'Selecionar Lucas Pereira',exact:true});
  assert(!(await older.isChecked()));
  await older.check();
  await training.getByLabel('Idade máxima para seleção automática').fill('16');
  assert(await older.isChecked());
  assert(await training.getByRole('checkbox',{name:'Selecionar Rafael Costa',exact:true}).isDisabled());
  await training.getByLabel('Idade máxima para seleção automática').fill('18');
  await training.getByRole('button',{name:'Aplicar aos selecionados'}).click();
  await training.getByText('Falha simulada').waitFor();
  await training.getByRole('button',{name:'Exportar diagnóstico'}).click();
  await training.getByText('desenvolvimento-teste.json',{exact:false}).waitFor();
  const activation=await page.evaluate(()=>window.__suite.requests.find(([name,args])=>name==="development_set"&&args.multiplier===5)?.[1]);
  assert.deepEqual(activation.selectedPlayers,[90000,90001]);
  assert.equal(activation.weekly,true);
  results.push('5× semanal, seleção acima da idade, diagnóstico de falha individual e exportação');
  await training.getByRole('tab',{name:'Grupos, perfis e listas'}).click();
  await training.getByLabel('Nome do save').fill('Teste isolado');
  await training.getByRole('button',{name:'Abrir ou criar perfil do save'}).click();
  await training.getByText('Teste isolado',{exact:true}).waitFor();
  const workspace = training.getByRole('region',{name:'Partida, grupos, perfis e listas'});
  await workspace.getByLabel('Nome',{exact:true}).fill('Grupo de teste');
  await workspace.getByRole('button',{name:'Criar',exact:true}).click();
  await workspace.getByLabel('Teto de CA',{exact:true}).fill('160');
  await workspace.getByRole('button',{name:'Guardar configurações'}).click();
  const config=await page.evaluate(()=>window.__suite.requests.find(([name])=>name==="development_settings")?.[1]);
  assert.equal(config.settings.groups["Grupo de teste"].rules.ceiling,160);
  assert.deepEqual(config.settings.groups["Grupo de teste"].players.map(p=>p.uid),[90000,90001]);
  results.push('Configuração de grupo com dados da seleção e teto de CA');
  await training.getByRole('tab',{name:'Gráfico de evolução'}).click();
  await training.getByLabel('Adicionar jogador à comparação').selectOption('90000');
  await training.getByLabel('Adicionar jogador à comparação').selectOption('90001');
  const chart=training.getByRole('img',{name:'Evolução observada na data do FM'});
  await chart.waitFor();
  assert.equal(await chart.locator('circle').count(),4);
  await training.getByRole('combobox',{name:/Período/}).selectOption('month');
  assert.equal(await chart.locator('circle').count(),2);
  results.push('Comparação do gráfico por semana e mês com apenas observações recebidas');
  for(const [tab,kind] of [['Evolução Imediata','evolve'],['Gestor de Contratos','contract'],['Copiar atributos','copy']]) {
    await training.getByRole('tab',{name:tab,exact:true}).click();
    const tool=training.getByRole('region',{name:tab});
    if(kind==='copy') {
      await tool.getByLabel('Buscar jogador de origem').fill('Bruno');
      await tool.getByRole('button',{name:'Buscar origem'}).click();
      await tool.getByRole('checkbox',{name:'Mentais',exact:true}).check();
    }
    if(kind==='contract') {
      await tool.getByRole('combobox',{name:/Ajuste salarial/}).selectOption('percent');
      await tool.getByLabel('Ajuste (%)',{exact:true}).fill('10');
    }
    assert(await tool.getByRole('button',{name:'Aplicar alterações conferidas'}).isDisabled());
    await tool.getByRole('button',{name:'Conferir alterações'}).click();
    await tool.getByRole('table',{name:'Prévia do lote'}).waitFor();
    await tool.getByRole('button',{name:'Aplicar alterações conferidas'}).click();
    await tool.getByRole('cell',{name:'Aplicado e relido'}).waitFor();
  }
  results.push('Prévia obrigatória, CA imediato, contrato e cópia com resultado individual');
  await training.getByRole('tab',{name:'Elenco',exact:true}).click();
  const fitness=training.getByRole('region',{name:'Central de condição física'});
  await fitness.getByRole('checkbox',{name:'Selecionar Bruno Silva',exact:true}).check();
  await fitness.getByLabel('Preset').selectOption('match');
  await fitness.getByRole('button',{name:'Conferir alterações'}).click();
  await fitness.getByRole('cell',{name:'97%'}).waitFor();
  results.push('Condição física com preset e prévia explícita');
  await page.getByRole('button',{name:'Meu clube',exact:true}).click();
  await page.getByRole('button',{name:'Perfil do clube',exact:true}).click();
  const profile=page.locator('.workspace:not(.inactive) .profile');
  await profile.getByRole('tab',{name:'Centro de Transferências',exact:true}).click();
  await profile.getByRole('row',{name:/Jogador com proposta de demonstração/}).click();
  assert(await profile.getByLabel('Valor à vista da proposta').isEnabled());
  assert(await profile.getByLabel('Data da transferência',{exact:true}).isDisabled());
  await profile.getByLabel('Buscar proposta').fill('22');
  assert.equal(await profile.getByRole('row',{name:/Jogador confirmado/}).count(),0);
  await profile.getByLabel('Buscar proposta').fill('');
  await profile.getByRole('row',{name:/Jogador confirmado de demonstração/}).click();
  assert(await profile.getByLabel('Data da transferência',{exact:true}).isEnabled());
  await profile.getByLabel('Data da transferência',{exact:true}).fill('2027-08-01');
  await profile.getByRole('button',{name:'Conferir alterações'}).click();
  await profile.getByRole('table',{name:'Prévia das alterações'}).getByRole('cell',{name:'01/08/2027'}).waitFor();
  await profile.getByRole('button',{name:'Aplicar na proposta'}).click();
  await profile.getByText('Proposta atualizada.',{exact:true}).waitFor();
  results.push('Transferências com busca por nº, valor pendente, reagendamento confirmado e prévia');
  await profile.getByText('Lendo ou atualizando propostas…',{exact:false}).waitFor({state:'hidden'});
  await profile.getByRole('tab',{name:'Entendimento tático',exact:true}).click();
  await profile.getByText('Jogadores e prévia',{exact:false}).click();
  await profile.getByRole('button',{name:'Desmarcar todos',exact:true}).click();
  await profile.getByRole('checkbox',{name:'Selecionar Bruno Silva',exact:true}).check();
  await profile.getByRole('combobox',{name:/Nível/}).selectOption('85');
  await profile.getByRole('button',{name:'Aplicar coesão conferida'}).click();
  await profile.getByText('1 no nível solicitado após releitura',{exact:false}).waitFor();
  const selected=await page.evaluate(()=>window.__suite.requests.filter(([name])=>name==='team_action').map(([,data])=>data));
  assert.deepEqual(selected[0].targets,[90000]);
  assert.equal(selected[0].cohesionLevel,85);
  results.push('Coesão alta em apenas um jogador e confirmação por releitura');
  const watch = profile.getByRole('checkbox',{name:/Monitorar coesão semanalmente/});
  await watch.check();
  await profile.getByText(/Leituras semanais de coesão · 1/).waitFor();
  await profile.getByRole('tab',{name:'Finanças',exact:true}).click();
  await page.evaluate(()=>window.__suite.advanceWatch());
  await profile.getByRole('tab',{name:'Histórico financeiro',exact:true}).click();
  await profile.getByRole('button',{name:'Registrar valores da data atual'}).click();
  await profile.getByRole('table',{name:'Registros financeiros por data do FM'}).waitFor();
  results.push('Histórico financeiro mostra uma leitura por data e envia o perfil da carreira');
  await profile.getByRole('tab',{name:'Entendimento tático',exact:true}).click();
  await profile.getByText(/Leituras semanais de coesão · 2/).waitFor();
  assert(await watch.isChecked());
  results.push('Monitoramento mantém a inscrição e recupera leitura feita com a aba fechada (simulado)');
  await page.getByRole('button',{name:'Alertas',exact:true}).click();
  const alerts = page.getByRole('dialog',{name:'Central de alertas'});
  await alerts.getByText(/falha\(s\) na última verificação de desenvolvimento/).waitFor();
  await alerts.getByRole('button',{name:'Fechar',exact:true}).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('group',{name:'Filtros da busca geral'}).getByRole('combobox').selectOption('club');
  await page.getByRole('combobox',{name:'Buscar ou executar ação',exact:true}).fill('Verificador de integridade');
  await page.getByRole('option',{name:/Verificador de integridade/}).click();
  const integrity = page.getByRole('dialog',{name:'Verificador de integridade'});
  await integrity.getByRole('table').waitFor();
  await integrity.getByRole('button',{name:'Fechar',exact:true}).click();
  results.push('Ações globais, categoria da busca, central de alertas e integridade');
  await page.getByRole('button',{name:'Treino',exact:true}).click();
  await page.getByRole('tab',{name:'Desenvolvimento',exact:true}).click();
  await page.getByRole('tab',{name:'Grupos, perfis e listas',exact:false}).click();
  await page.getByText('Backup e restauração seletiva do Desenvolvimento',{exact:true}).click();
  await page.getByRole('button',{name:'Gerar backup JSON',exact:true}).click();
  const backup = page.getByRole('textbox',{name:'JSON do backup'});
  const saved = JSON.parse(await backup.inputValue());
  saved.settings.lists = {Favoritos:[]};
  saved.settings.groups = {};
  await backup.fill(JSON.stringify(saved));
  await page.getByRole('checkbox',{name:'Listas e favoritos',exact:true}).check();
  await page.getByRole('button',{name:'Carregar seções no rascunho'}).click();
  await page.getByText(/Seções carregadas no rascunho/).waitFor();
  await page.getByRole('button',{name:'Guardar configurações',exact:true}).click();
  const lastSettings=await page.evaluate(()=>window.__suite.requests.filter(([name])=>name==='development_settings').at(-1)[1].settings);
  assert.deepEqual(lastSettings.lists,{Favoritos:[]});
  assert(Object.keys(lastSettings.groups).length>0);
  results.push('Restauração seletiva de listas preserva os grupos e só grava após confirmação');
  assert.deepEqual(crash,[]);
  console.log(JSON.stringify({results,crash},null,2));
})().catch(async err=>{
  console.error(err);
  if(page) console.log((await page.locator('body').innerText()).slice(-3500));
  process.exitCode=1;
}).finally(async()=>{ await browser?.close();server.kill(); });

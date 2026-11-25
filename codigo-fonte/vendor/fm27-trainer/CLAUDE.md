# FM27 Trainer: overdracht voor Claude

Lees dit eerst. Het vat alles samen wat in de eerste sessies (macOS, november 2026) is uitgezocht en gebouwd, zodat
je op een Windows-pc verder kunt. De gebruiker (Sem) is Nederlandstalig: antwoord in het Nederlands, kort en concreet.

## Wat het is

Een Rust-app (egui) voor Football Manager 27:

1. **Tactical Effectiveness uitlezen.** Schermafbeelding van FM's *Breakdown*, OCR (Apple Vision / Windows.Media.Ocr),
   taartmeters meten → 4 componenten + 17 key factors.
2. **Training plannen** op de zwakste gebieden, met de 59 sessies en 99 presets uit FM27's eigen data.
3. **Live in FM** (via een module): training in FM's kalender zetten en bijhouden (FM's assistent plant elke week de
   komende 1–2 weken opnieuw in; de app zet ze terug), budget, blessures, schorsingen, moraal, **spelers direct
   verkopen** aan en **kopen** van een andere club, en **tactisch begrip maximaliseren** (zoals FM's in-game editor).

Repo's (GitHub `SemHiel2003`):
- `fm27-trainer`: **openbaar**, releases v0.2.0 (genotariseerde Mac-DMG + Windows-zip), v0.2.1, v0.2.2 (8 nov 2026) en v0.2.3 (9 nov 2026,
  alleen Windows-zip via GitHub Actions, met de fixes voor de gebruikersmeldingen; de Mac-DMG komt van `./release.sh`
  op de Mac en is voor 0.2.3 nog niet gemaakt). Daar níét zomaar naar pushen; de dev-repo
  is er een voorouder van (fast-forward), en de release ontstaat door een tag `v*` naar de openbare repo te pushen (notes in
  `docs/releases/<tag>.md`). Lokaal heet die remote `public`. Vaste downloadlinks (altijd de nieuwste release, voor de
  downloadpagina's elders): `https://github.com/SemHiel2003/fm27-trainer/releases/latest/download/FM27-Trainer-Windows.zip`
  en `.../FM27-Trainer-macOS.dmg` (de DMG heet sinds 0.2.2 zo, zonder versienummer; de versie staat in de app).
- `fm27-trainer-dev`: **privé**, deze repo, met het nieuwste werk (verkopen, onderzoek biedingen, datumfix).

## Opbouw

```
app/                 de app (bin fm27-trainer): egui UI, OCR, planner, live-client
  src/main.rs        CLI: analyze, year, agent '<json>', agent-serve, train [--write], start-fm
  src/gui.rs         alle pagina's (Overzicht, Training, Planning, Club, Selectie, Verkopen, Instellingen)
  src/live.rs        verbindingstoestand, achtergrondtaken, automatisch training bijhouden (elke 8 s)
  src/live_training.rs  kalender lezen → plannen → per week schrijven
  src/agent.rs       macOS: socket naar de module; Windows: roept fm27_agent::request rechtstreeks aan
  src/planner.rs, model.rs, vision.rs, export.rs, theme.rs, i18n.rs (t!("nl", "en"))
  src/labels.rs      de Breakdown-labels in alle 20 talen van FM (gegenereerd, tools/research/breakdown_labels.py)
agent/               crate fm27-agent: de spellogica, gedeeld
  src/lib.rs         dispatch van alle opdrachten (JSON); macOS: module in FM + socket-server
  src/mem.rs         geheugen: macOS (Mach, eigen proces), Windows (ReadProcessMemory/WriteProcessMemory op fm.exe),
                     tests (gesimuleerd geheugen)
  src/rtti.rs        klassen herkennen: Itanium (clang/macOS) en MSVC (Windows)
  src/game.rs        veldposities per platform (Layout MAC/WIN), builds (BUILDS), manager/club/selectie/training/undo
  src/sell.rs        speler direct verkopen én kopen (één verhuisfunctie `relocate`), clubs zoeken, selectie van een club
  src/understanding.rs  tactisch begrip (Tactical Understanding) per speler lezen en maximaliseren
  src/tests.rs       hele flow tegen gesimuleerd FM-geheugen, beide indelingen; MSVC-RTTI tegen testdata/rtti_test.dll
docs/TECHNICAL.md    architectuur en posities; docs/research/fm27-transfer-offers.md: onderzoek biedingen
tools/research/      fmq.py (onderzoeksclient), offers.py, breakdown_labels.py (labels uit FM's languages.fmf),
                     vision_regress.py (regressietest schermuitlezing: varianten van een opname, ook in andere talen)
```

Alle opdrachten van de module: `ping`, `club`, `squad`, `set_finances`, `heal`, `lift_bans`, `inspire`, `undo`,
`game_date`, `training_weeks`, `set_week`, `clubs`, `club_squad`, `sell`, `buy`, `understanding`, `max_understanding` (met `dry_run`),
`human_flags`, `set_human_flags`, `tactics`, `teams`, `select`,
`allow_untested`, en voor onderzoek `chain`, `census`, `class_of`, `read`, `find_u16`, `find_bytes`, `find_ptr`, `write` (alleen
met `expect`), `discover`. Zie `agent/src/lib.rs`.

## Bouwen en testen op Windows

- Rust stable met de MSVC-toolchain (`rustup default stable-x86_64-pc-windows-msvc`) en Visual Studio Build Tools
  (workload "Desktop development with C++").
- `cargo test -p fm27-agent`: 12 tests, `cargo test -p fm27-trainer`: 3 tests (nagemaakte taartmeters); horen allemaal te slagen.
- `cargo run -p fm27-trainer`: de app. `cargo build --release -p fm27-trainer` → `target\release\fm27-trainer.exe`
  (statische C-runtime via `.cargo/config.toml`).
- **De release-exe heeft geen console** (`windows_subsystem = "windows"`). Gebruik voor de CLI de debug-build:
  `cargo run -p fm27-trainer -- agent "{\"cmd\":\"ping\"}"`. Voor scripts: `agent-serve` (stdin/stdout, werkt ook
  met de release-exe), zie `tools/research/fmq.py`.
- De Mac-DMG kan alleen op de Mac (`./release.sh`, Developer ID + notarisatie). Windows-zip: GitHub Actions
  (`.github/workflows/release.yml`, bij een tag `v*` of handmatig met `platform=windows`).
- Op deze pc (8 nov 2026 geïnstalleerd): rustup (`%USERPROFILE%\.cargo\bin`), VS Build Tools 2022 (MSVC 14.44,
  SDK 10.0.26100) en Python 3.12 (`%LOCALAPPDATA%\Programs\Python\Python312`); beide mappen staan op het
  gebruikers-PATH (een al open terminal ziet dat pas na een herstart). Python met `-X utf8` draaien, anders
  struikelt de console over accenten in spelersnamen.
- De agent-crate wordt ook in de debug-build geoptimaliseerd (`[profile.dev.package.fm27-agent]` in Cargo.toml):
  zonder dat duurt een heap-scan ruim een minuut in plaats van 1,5 s.

## Hoe live werkt op Windows

- De app zoekt `fm.exe` (Toolhelp), opent het met `PROCESS_VM_READ | VM_WRITE | VM_OPERATION | QUERY_INFORMATION`
  en leest/schrijft van buitenaf. FM gewoon via Steam starten; geen module of injectie.
- De native kern heet `game_plugin.dll`. Een build heet `PE-<linktijd>-<SizeOfImage>`; Steam 26340721 =
  `PE-6AE565AF-1821C000`, Game Pass / Xbox-app 0.9.2409.0 = `PE-6AE563A1-175DA000` (zelfde update, zelfde
  objectindeling; vaste plekken uit FMLibreEditor `profiles/fm27/gamepass-0.9.2409.0.toml`; schrijven staat aan,
  **niet door ons live getest**). Onbekende build → geen vaste adressen (staflijst, clublijst, datum).
  Game Pass draait ook als `fm.exe` (uit `...\Content\`); een Xbox-console kan de app niet lezen.
- **Builds na de release** (12 nov 2026, na meldingen "not connected" op sortitoutsi en GitHub #1/#2; alle vaste
  plekken uit FMLibreEditor `profiles/fm27/`, objectindeling volgens hen ongewijzigd): Steam 26385295 (10 nov) =
  `PE-6AE8B5A4-17CB9000` en 26577676 (12 nov) = `PE-6AF38E5C-185FA000`, beide staf 0x5820858, clubs 0x58209C8, datum
  0x57CA3B8; Game Pass 0.9.2435.0 = `PE-6AE8CF77-17969000`, staf 0x53B7E28, clubs 0x53B7F98, datum 0x53597C8; Mac
  arm64 26385295 (`2A2D0ED6-…`) en 26577676 (`A8550B47-FDE0-3D0D-A6CB-1B63DEE8DA19`), beide staf 0x576EE98, clubs
  0x576F008, datum 0x574DDB8; de Intel-helften staan ook in `BUILDS`. Schrijven: Mac arm64 26577676 **live getest**
  (12 nov 2026); de drie Windows-builds staan aan **op grond van FMLibreEditor's meting** (besluit van Sem; hij test
  Windows zelf na); Mac 26385295 en Intel: alleen lezen.
- **Onbekende build** (`game::statics` → `discover`): de app zoekt de lijsten zelf. Het clubpaar staat in alle 11
  gemeten profielen 0x170 achter het stafpaar; gezocht wordt naar twee pointerlijst-paren op die afstand (grootste
  eerst) waarvan het tweede clubs bevat en het eerste een manager met kloppende keten die bij een club uit die lijst
  uitkomt. Datum: binnen 0x400 van de afstand datum↔staflijst van de bekende builds van hetzelfde platform, passend
  bij de teamdatum; anders de teamdatum zoals vroeger. Schrijven blijft dan uit tot `allow_untested`. Gemeten op de
  Mac: 1.945 dubbele paren in `__DATA`, 21 datum-achtige waarden, precies één binnen 0x400; de spel-datum heeft
  vlagbits boven de dag (0x19). Onderzoeksopdracht `discover` vergelijkt de zoektocht met het profiel; `ping` geeft
  `statics: profile|discovered|null` en `build_label`. Bij een nieuwe patch: profiel uit FMLibreEditor overnemen in
  `BUILDS` en de procedure van Taak 1 doen.
- **Schrijven staat op Windows aan** voor Steam-build 26340721 (`writes_tested: true` in `BUILDS`,
  `agent/src/game.rs`; live gecontroleerd op 8 nov 2026). Op een onbekende build (na een FM-patch) staat de app op
  alleen lezen; de gebruiker kan het per sessie toestaan (Instellingen → "Aanpassen op een niet-geteste FM-versie" →
  opdracht `allow_untested`).
- `game_plugin.dll` is **ingepakt**: secties heten `.xtext`, `.data1`, `.shared`, `.rodata`, `.sbss` (307 MB, wordt
  bij het laden gevuld), `.rdata` (klein). De beschermer hernoemt ze per build: op Game Pass staan de TypeDescriptors
  in `.00cfg` en heet de grote RWX-sectie `.rsrc`. De MSVC-RTTI-zoeker doorzoekt daarom **alle** secties, ongeacht de
  naam (`msvc_areas` in `agent/src/rtti.rs`; tot 9 nov 2026 sloeg hij `.rsrc`/`.00cfg` over, waardoor de app op Game
  Pass geen manager vond); een blok dat niet in één keer leesbaar is,
  wordt in kleinere stukken geprobeerd (`mem::for_each_chunk`). `class_of` op het managerobject zelf geeft None
  (vbptr); de manager wordt via de staflijst gevonden. Een klasse opzoeken kost eenmalig ~1,5 s, een volledige
  heap-scan (3,5 GB) ~1,5 s in een release-build.

## Versie 0.2.6 (13 nov 2026)

- **Fork van arhxmmmmm** (`arhxmmmmm/forked-fm27-trainer`, MIT, gebaseerd op 0.2.3; sortitoutsi-post 78504 "Game Pass
  fix"): vier wijzigingen. (1) Manager zoeken via `HUMAN_NON_PLAYER_MANAGER` (gewone vtable op offset 0, lijst van
  menselijke managers op +0x18, gemeten op Game Pass 0.9.2435.0): overgenomen als derde zoekweg op Windows
  (`human_via_manager_list` in `agent/src/game.rs`), na de staflijst en de RTTI; alleen in simulatie gebouwd, niet
  live getest. (2) Eerste woord van een dagblok: zat al in 0.2.5. (3) Middelgrijze lege segmenten op Game Pass: hun
  test `pies_with_grey_empties_and_neighbouring_icon` slaagt op onze uitlezing van 0.2.4 zonder wijziging; de test
  is toegevoegd. (4) Automatisch uitlezen: eigen versie in `app/src/gui.rs` (schakelaar op Overzicht, elke 5–120 s,
  haalt FM niet naar voren, telt alleen een volledige uitlezing zonder twijfel, doet niets als de waarden gelijk
  zijn, uit tijdens handmatig aanpassen en met `FM27_SNAPSHOT`).
- **UI** (`app/src/theme.rs`): nieuw palet, ringmeters op de vier tegels (`ring`), balken en ringen groeien bij het
  openen van een pagina (`enter`/`restart_enter`) en glijden mee bij een nieuwe waarde, zijbalk en primaire knop
  met zachte overgang, pagina vervaagt in. Alleen bekeken zonder verbinding (Overzicht, Training, Planning,
  Instellingen); Club, Selectie en Transfers met een verbonden FM zijn niet opnieuw bekeken.
- `cargo test -p fm27-trainer`: nu 4 tests (9 met de tactiekhulp van 14 nov, 10 met de rusttest van 16 nov).

## Versie 0.2.7 (16 nov 2026, uitgebracht) en open meldingen

- Uitgebracht op 16 nov 2026: tag `v0.2.7` op `origin` (openbaar), commit `c01d144`, Mac-DMG (genotariseerd, via
  `./release.sh` + `gh release upload`) en Windows-zip (GitHub Actions). Lokaal heet de openbare remote `origin`
  en de privé repo `dev`. Sortitoutsi (post 78370) is bijgewerkt en er staat een release-bericht.
- **Open: "colour and fill disagree"** (twee melders op 0.2.6: Tactical Complexity, Opposition Player Knowledge,
  beide de onderste rij van een groepje van twee). Oorzaak onbekend; de banden in `color_band` (`app/src/vision.rs`)
  zijn alleen op Sem's Ajax- en Sunderland-opnames gemeten. Vraag om `last-breakdown.png` en `last-analysis.txt`.
  Voorstel zonder antwoord van Sem: alleen melden, de waarde niet bijstellen.
- **Open: Windows Defender / browser "virus detected"** op de Windows-zip. Vermoedelijk vals alarm (niet-ondertekende
  exe die geheugen van fm.exe leest en schrijft); niet door Microsoft bevestigd. Oplossingen: indienen bij Microsoft
  als vals alarm (moet Sem zelf doen) of code-signing.
- GitHub #5 staat open tot de melder bevestigt. Op Windows heeft de app geen startknop voor FM (alleen de Mac).
- Antwoordteksten voor forums: Engels, in een codeblok (geen citaatopmaak), zodat Sem ze kan kopiëren.
- Sem's Obsidian-kluis staat in `/Users/semhiel/Documents/Obsidian/Sem` (projectnotitie `Projecten/FM27 Trainer.md`).

## FM-update van 17 nov 2026 (Steam 26620374) en versie 0.2.8 (uitgebracht op 17 nov 2026)

- Uitgebracht: commit `e09460c`, tag `v0.2.8` op `origin` en `dev`, Mac-DMG (genotariseerd) en Windows-zip. GitHub #6
  beantwoord (open tot de melder bevestigt); sortitoutsi-post bijgewerkt (via de CKEditor-instantie op de
  bewerkpagina) en één reactie geplaatst voor Likes Banter Clubs, toomuchcoldbrew en Lajos Dijkstra. Wachten op
  meldingen of Windows weer verbindt.

- Meldingen "verbindt niet na de update" (GitHub #6, sortitoutsi). **Oorzaak**: in het financiënblok staat
  corporate niet meer op `+0x8A9` maar op `+0x8AD` (Tottenham 20, Ajax 18; `+0x8A9` is bij elke club 0).
  `finance_looks_real` eiste 1–20 op `+0x8A9` en keurde dus elke managerketen af, ook in de eigen zoektocht
  (`discover`) en via RTTI. Nu mag het op beide plekken (`FIN_CORPORATE`). Saldo, budgetten en ticketprijs zijn
  niet verschoven; de rest van de objectindeling las op de Mac gewoon goed.
- Mac arm64 `869F5F90-FD89-3606-8AE4-2B4A7F02F324`: staf 0x57A3010, clubs 0x57A3180, datum 0x5781DC8 (zelf
  gemeten, `discover` geeft `same: true`). **Live getest** (Ajax-save, 18 okt 2028): club, selectie, kalender
  (97 weken), teams, clubs, tactisch begrip, tactiek; datum en budgetten gelijk aan FM's scherm; `set_finances` +1,
  `inspire` 18→20, `set_week` één dag, elk met `undo` en exact terug; `sell` en `max_understanding` als `dry_run`.
  Schrijven staat aan. Intel-helft (`864625AF-9AA9-3254-8EC5-47E9D486132A`) en **Windows: geen profiel, niet
  getest**; die moeten het met `discover` doen (alleen lezen tot `allow_untested`). Of de verschuiving op Windows
  dezelfde is, is een aanname (financiën zijn tot nu toe op beide platforms gelijk). FMLibreEditor had op 17 nov
  nog geen profiel: overnemen in `BUILDS` zodra het er is.
- Bij een volgende patch waarin "geen menselijke manager" verschijnt terwijl een save geladen is: eerst de keten
  met de hand nalopen (`census` op `HUMAN_NON_PLAYER` → `find_ptr` op de vtable → contract `+0x4B0` op de Mac →
  team → club → financiën); de strenge controles in `check_chain` zijn de eerste verdachte.
- Nieuw: Instellingen → Planner → "Geen tactische sessies" (`PlannerSettings.no_tactical`, verzoek op sortitoutsi
  van iemand die "Op 100 % houden" gebruikt): tactische plekken gaan naar ontwikkelsessies (`DEVELOPMENT` in
  `planner.rs`); wedstrijd-, herstel- en rustdagen blijven gelijk. Test `no_tactical_sessions` (nu 11 tests in
  de app). Niet in FM's kalender nagekeken.
- 17 nov, avond: Likes Banter Clubs bevestigt op sortitoutsi dat 0.2.8 op **Windows Steam** weer verbindt (dus via
  `discover`; schrijven niet bevestigd). Open: nicolas montiel, "no human manager with a club found" ook na opnieuw
  installeren; platform en versie onbekend, om details gevraagd (comment_917651). Vermoeden: Game Pass, niet bevestigd.
- Open: Lajos Dijkstra (sortitoutsi, Windows, "latest version", verbindt niet; eerste melding van vóór de update).
  Op 17 nov om details gevraagd (Steam of Game Pass, save geladen, statusregel).

## Mac-opname (13 nov 2026, uitgebracht in 0.2.7)

- Melding van Sem: "No Football Manager window found" terwijl FM draaide. Oorzaak: xcap vraagt alleen vensters op
  die nu in beeld zijn (en slaat vensters zonder titel over, dus alles zonder Schermopname-toestemming). FM stond
  schermvullend op een andere Space dan de app (zelfde beeldscherm). De Mac gebruikt nu een eigen opname
  (`mac_capture` in `app/src/vision.rs`): alle vensters (`OptionAll`), grootste venster van FM op laag 0, opname op
  venster-id; aparte melding zonder toestemming en bij een zwart beeld. Gemeten: FM-venster `onscreen false`, opname
  2560×1440 klopt. Windows gebruikt nog xcap. Diagnose: `fm27-trainer windows [opname.png]`.
- `fm27-trainer analyze` (CLI) blijft op macOS 27.2 hangen in de Vision-OCR (wacht op een semafoor; de CLI heeft geen
  draaiende hoofdlus). In de app, waar de uitlezing op een achtergrondthread loopt, speelt dat niet. Niet opgelost.

## Tactiekhulp en Tactical Effectiveness uit het geheugen (14 nov 2026, versie 0.2.7)

- **Tactiekhulp** (pagina Tactiek, `app/src/tactics.rs`, opdracht `tactics` in `agent/src/tactic.rs`, alleen lezen):
  per tactiek de elf plekken met rol met/zonder bal, van elke speler 15 positiecijfers en 47 attributen; de app
  rekent geschiktheid per plek, de beste elf (Hongaarse methode, een wissel moet ≥ 1,5 opleveren) en rollen die
  beter passen. Feiten uit FMLibreEditor (`layout*.toml`, `docs/recon/fm27-tactics-and-value.md`), op de Mac
  nagekeken tegen FM's tactiekscherm (Steam 26577676, Ajax, tactiek 3 "Guardiolaball"): selectie-object `+0x08`
  lijst van 3 blokken, **`+0x20` i8 tactiek in gebruik** (las 2 = tactiek 3), `+0x28` persoons-id's; blok `+0x100`
  stijl, rolmaskers Mac `+0x160`/`+0x480` (Windows `+0x158`/`+0x478`), stap 0x48; na een byte 0x1B rond `+0x7A8`
  de tabel plek-met-bal → plek-zonder-bal. De plekken met bal staan in de volgorde van de basiself, die zonder bal
  in veldvolgorde per linie van rechts naar links: daaruit leidt de app links/rechts af (alleen op deze ene
  tactiek gezien). De basiself hoort alleen bij de tactiek in gebruik. Nieuwe rolbits: 15 = DLP, 40 = F9,
  57 = MPM. Nog zonder naam gezien: met bal 0 (op de keepersplek), 31, 41, 49; zonder bal 30, 35 (de app toont
  `#n` en neemt de linie uit FM's nummering). **Welke attributen bij een rol horen is eigen inschatting**, niet
  uit FM. Tijdens een wedstrijd zijn er ~60 selectie-objecten (10 van de club, alle gelijk).
  Getest: simulatie (beide indelingen, in `run_market`), 5 tests in de app, en de pagina met gegevens die een
  script met dezelfde stappen uit het draaiende FM las (`FM27_TACTICS_JSON=<bestand> FM27_PAGE=tactics`). De
  module-opdracht is daarna **live gedraaid op de Mac** (FM herstart met de nieuwe module): tactiek 3, alle elf
  spelers en rollen en de bank (11) gelijk aan FM's tactiekscherm. Windows is alleen simulatie. Sem gebruikt
  alleen tactiek 3; de rolnamen van tactiek 1 en 2 zijn niet aangevuld.
- **Tactical Effectiveness uit het geheugen: niet gelukt, niet af.** FM rekent de cijfers uit; ze staan niet
  kant-en-klaar in het object van de trainingsmanager per manager (TRAINING_MANAGER `+0x38` lijst van managers,
  `+0x98` club; eerste 0x400 bytes bekeken). De formule-constanten staan in `simatch.fmf` →
  `constants/generated_tactical_effectiveness_constants.jsb` (gewichten: totaal = 0,5 TU + 0,15 PA + 0,2 PBI +
  0,15 NMI; drempels 7/16/34/41/51/67/81/91; MIN 7, MAX 100), verder `…training_contribution…` en
  `…tactical_complexity…` (daar staan ook alle 41 rolnamen met en zonder bal). `tools/jsb.py` leest nu ook
  kommagetallen (type 7) en de korte vormen (kleine gehele getallen: nibble − 8; 0x27 = 0,5, 0x37 = 1,0).
  Volgende stap: met de Breakdown open (en zonder dat Sem speelt) de getoonde waarden in het geheugen zoeken
  (`find_bytes`), anders de berekening per key factor nabouwen.
- **Niet in FM klikken met `orca computer`**: klikken kwamen op andere knoppen terecht (o.a. "Messages") en één
  kwam in een lopende wedstrijd van Sem terecht. Een opname van het FM-venster maken kan wel zonder iets aan te
  raken (`fm27-trainer windows <png>`).

## Meer managers, andere teams en rustniveau (16 nov 2026, uitgebracht in 0.2.7)

- Aanleiding: sortitoutsi-reacties ("tweede team leest de meters goed uit maar zet de training niet", "doet hij
  ook de jeugdteams?", "verschillende rustniveaus"). De app nam altijd de **eerste** menselijke manager met een
  club; bij twee managers in één save ging alles naar de eerste. Dat dit de oorzaak van de melding is, is een
  aanname: niet bevestigd door de melder.
- Module: `humans()` geeft alle menselijke managers; `chain()` neemt die van de gekozen club (`State.chosen_club`),
  anders de eerste. `training_team()` = gekozen team uit de teamlijst van de club (`club+0x18`,
  `State.chosen_team`), anders het team uit het contract; alleen `training_weeks`/`set_week` gebruiken dat, de
  selectie en de rest blijven het eigen team. Het trainingsblok wordt nu per team onthouden. Opdrachten `teams`
  en `select {club?, team?}` (een club zonder menselijke manager verandert niets). Team `+0x28` u8 soort
  (0 eerste elftal, 10 O21, 12 O18), `+0x2C` u8 leeftijdsgrens (100 = geen): feiten uit FMLibreEditor, door ons
  niet gemeten.
- App: keuze op de Training-pagina (alleen zichtbaar bij > 1 manager of > 1 team), bewaard in de instellingen
  (`manager_club`, `training_team`) en bij elke verversing en vóór elke trainingsopdracht opnieuw doorgegeven.
  Testhulp `FM27_TEAMS_JSON=<bestand>`. Instellingen → Planner → Rust (`planner::Load`: Light / Balanced /
  Intense).
- **Alleen simulatie** (`run_market`: tweede manager bij Milan, eigen kalender voor het jeugdteam, schrijven +
  undo) en een plannertest. **Niet live getest**: of FM voor een jeugd- of B-team een eigen weeklijst bijhoudt,
  is niet gemeten. Er is één set uitgelezen waarden; die wordt niet per team bewaard.

## Intel-Mac start niet (GitHub #5, 16 nov 2026, uitgebracht in 0.2.7)

- 0.2.6 crashte bij het starten op een Intel-Mac (macOS 15): `Library not loaded: @rpath/libswiftCoreMedia.dylib`,
  `no LC_RPATH's found`. Nagekeken op de uitgebrachte DMG: alleen de x86_64-helft had die koppeling (via xcap →
  AVFoundation/CoreMedia), de arm64-helft niet. xcap is nu alleen nog een afhankelijkheid buiten macOS
  (`app/Cargo.toml`); de Mac heeft zijn eigen opname. De Intel-build heeft geen Swift-koppeling meer en start
  onder Rosetta (`arch -x86_64 … help`). Niet op een echte Intel-Mac getest.

## Veiligheidsregels (altijd)

- Schrijven alleen via `write_checked`/`Patch`: eerst controleren dat het geheugen nog precies is wat je verwacht,
  daarna teruglezen. Elke wijziging met undo (`Change` in game.rs; geld als verschil).
- Experimenten alleen in een **aparte test-save**, en de gebruiker mag tijdens een experiment **niet doorspelen of
  opslaan**. Na een experiment: FM sluiten zonder op te slaan, of netjes terugzetten.
- Lijsten waarvan de plek iets betekent (de biedingenlijst: bodnummer = index) nooit opschuiven.
- `find_ptr` vindt ook de eigen buffers van de module: altijd controleren met `u64(a) == target`. Limiet 200.
- FMLibreEditor (github.com/tozmoz/FMLibreEditor) is GPL: gebruik hun **feiten** (posities, gedrag), kopieer geen code.
  Dit project is MIT.
- Niet naar de openbare repo pushen of releasen zonder het te vragen.

## Posities (Steam-build 26340721)

Spelers en staf verschillen per platform; clubs, financiën, contracten, teams, blessures en schorsingen niet.

| Veld | macOS | Windows |
|---|---|---|
| Manager: contract / identiteitsblok (+ shift 0x340) | 0x170 / 0x208 | 0x1A8 / 0x100 |
| Speler: team, blessure-record | 0x128, 0xF0 | 0x130, 0xF8 |
| Speler: scherpte, conditie, moraal (u8 1–20) | 0x250, 0x254, 0x264 | 0x258, 0x25C, 0x26C |
| Speler: namen (voor, achter, roep) | 0x298, 0x2A0, 0x2A8 | 0x2D8, 0x2E0, 0x2E8 |
| Speler: contract, identiteitsblok, UID | 0x2F0, 0x388, 0x394 | 0x330, 0x288, 0x294 |
| Speler: transferwaarde, vraagprijs (i32 pond) | 0x22C, 0x230 | 0x234, 0x238 |
| Speler: record tactisch begrip (ptr, zie onder) | 0xF8 (niet gemeten) | 0x100 |
| Interne persoons-id | identiteitsblok + 8 | identiteitsblok + 8 |
| Speler-trainer: alles vanaf het persoonsblok verder met | 0xF8 | 0xF8 |

Gedeeld: contract `+0x08` eigenaar (→ identiteitsblok), `+0x10` team, `+0x18` senior team, `+0x20` salaris,
`+0x26` job (1 speler), `+0x30` ontevredenheid (ptr), `+0x44/+0x48/+0x4C` getekend/einde/bij club (datum),
`+0x57` transfer-/huurlijst (bit 0/1), `+0x5A` happiness (**i8**), `+0x5D` rugnummer (255 = geen).
Team `+0x30` club, `+0x38` spelerslijst (begin, end, cap), `+0x88/+0x90` (vice-)aanvoerder.
Club `+0x0C` UID, `+0x18` teams (eerste = eerste elftal), `+0xB9` vrouwenclub, `+0xC0` naam, `+0x150` financiën.
Financiën `+0x0C` saldo, `+0x7C4` transferbudget, `+0x808` totaal loonbudget, `+0x814` loonbudget (i32 pond),
`+0x864` ticketprijs (f32), `+0x8A9` corporate (u8). Blessure-record: lijst huidige blessures (genezen = end := begin),
`+0x18` afwezigheden (schorsing: `0xFFFF` op +0x16). Datum = u16 dag-van-het-jaar (lage 9 bits, rest vlaggen) + u16 jaar.

Vaste plekken (RVA in game_plugin):

| | macOS arm64 | Windows |
|---|---|---|
| staflijst (begin, end) | 0x56D2E60 | 0x5705818 |
| clublijst (begin, end) | 0x56D2FD0 | 0x5705988 |
| spel-datum | 0x56B1DB8 | 0x56AF378 |

De manager wordt gevonden via de staflijst (Windows eerst) of RTTI `db::HUMAN_NON_PLAYER`.
**Spel-datum:** altijd de vaste plek; team+0xA0→+0x94 is een ándere datum (rond de laatste wedstrijd).

**Training** (gemeten op macOS én Windows, beide **+0x28**): een blok per team met de team-pointer en op +0x28 een
lijst van weekrecords (0x60 bytes: `+0x00` naam van het schema (FM-string), `+0x0C` maandag, `+0x10` 7 × [u16 0,
sessie 1, sessie 2, extra], `+0x48` u32 nummer van het schema-sjabloon). Op Windows probeert de code voor de
zekerheid ook 0x08–0x80 met strenge controles, voor het geval een latere build afwijkt. **Zoeken** (9 nov 2026, na
meldingen "training calendar not found"): alle heapwoorden gelijk aan de team-pointer, zonder limiet (vroeger stopte
het bij 20.000; Sunderland-save: 2.042 treffers, kalender nummer 1.462). Een week telt als de maandag geldig is en ≥ 2/3 van de 21 vakken een bekende code (≤ 600), waarvan
≥ 5 niet nul; `set_week` laat een dag met een onbekende code ongemoeid. Vindt het niets, dan noemt de fout het aantal
treffers en waarom bijna-kandidaten afvielen. Het eerste woord per dag wordt sinds 13 nov 2026 niet meer gecontroleerd (nooit gelezen of geschreven): een
gebruiker op Windows (v0.2.4) had daar 0xEB00–0xEF00 en de oude eis ≤ 0xFF keurde al zijn 61 weken af (test
`calendar_with_large_first_word`).
Sessiecodes: 0–7 Tactical Understanding, 100–108 Match Preparation, 200–228 Footballing
Development, 300–307 Physical, 400 Team Bonding, 401 Community, 402 reizen, 500 wedstrijd.

**Opstellingen**: `simatch::PREPARED_TACTICS_CREATOR_ARRAY`, `+0x08` lijst, `+0x28` 26 × u32 persoons-id
(0xFFFFFFFF = leeg). Lijstblokken van de allocator: Mac 144…4096, Windows 144…512 (`heap_blocks`).

**Spelregels (editorvlaggen van de manager)**: u32 op manager+0x3FC (Windows; Mac onbekend, `Layout.human_flags`),
bit 0x100 = "Allow squad registration anytime", 0x200 = "Allow squad numbers anytime" (FM's in-game editor,
acties `TEAM_CONTAINER_ALLOW_SQUAD_REGISTRATION_ANYTIME_ACTION` / `..._SQUAD_NUMBERS_...`; de actie zet of wist het bit
op het object dat de HUMAN-record via vtable+0x698 teruggeeft, en dat is het managerobject zelf: het subobject op
manager+0x440 heeft de HUMAN_NON_PLAYER-vtable, wat de app controleert voor het schrijven). Standaard 0. Dat een
gezet bit "altijd toestaan" betekent, is afgeleid, niet in FM's scherm gezien: controleren op het registratiescherm
van een competitie. Opdrachten `human_flags`/`set_human_flags`, schakelaars op de Club-pagina ("Spelregels").

**Tactisch begrip** (FM27's "Tactical Understanding", de opvolger van tactical familiarity; gevonden op 8 nov 2026
door FM's editor-actie `TEAM_MAXIMISE_TACTICAL_UNDERSTANDING_ACTION` te disassembleren, zie
`agent/src/understanding.rs`): speler `+0x100` → record van 0xE0 bytes. Zes blokken van 0x20 (gebied 0–5: Passing
Style, Build Up, Chance Creation, In Possession Shape, Line of Engagement, Pressing Intensity): (begin, end, cap)-lijst
van u32-items (bits 0–13 niveau 0–10000, bits 14–19 tactiekinstelling 0–20, rest rommel) + u64 gebiedsnummer op
`+0x18`; op `+0xC0` een lijst van 16-byte-items voor Pressing Trap en Out Of Possession Shape (u16 rol/positie, 11
bytes vorm, u8 vlaggen, u16 niveau op `+0x0E`); `+0xD8` datum, `+0xDC` "veranderd". Begrip voor een instelling = max
over items van (niveau − 1000 × afstand), bodem 1000. Maximaliseren zet elk item op 10000 en voegt de meest
voorkomende instelling toe voor wie hem mist, alleen binnen de capaciteit van FM's lijst (geen eigen allocatie).
Live getest op Windows (8 nov 2026, Ajax-save, 27 spelers). **FM laat de niveaus elke speelweek zakken** (na vier
speelmaanden stond alles van 10000 weer op 7620), vandaar de schakelaar "Op 100 % houden" (instelling
`keep_understanding`): elke 20 s, bij de gewone verbindingscontrole, stuurt de app `max_understanding`, dat alleen
schrijft wat gezakt is. Het trainingsblok van TRAINING_MANAGER per team (zie boven) en `TACTICS_MANAGER` bevatten
dit níét. Disassembleren kan met capstone (`pip install capstone`) op code die
via `read` uit fm.exe komt; game_plugin.dll ligt op Windows ingepakt op schijf maar uitgepakt in het geheugen.

## Wat is getest, waar

| | macOS (live, Ajax-save) | Windows |
|---|---|---|
| uitlezen club/selectie/kalender | ✅ | ✅ (8 nov 2026, Ajax-save) |
| budget, genezen, moraal, training schrijven, undo | ✅ | ✅ (8 nov 2026) |
| verkopen (`sell`) | alleen simulatie | ✅ dry run én één echte verkoop + undo (8 nov 2026) |
| kopen (`buy`, `club_squad`) | alleen simulatie | dry run live (8 nov 2026); echte aankoop door de gebruiker te testen |
| spelregels (`set_human_flags`) | n.v.t. (plek onbekend) | gelezen (0); effect in FM door de gebruiker te controleren |
| tactisch begrip (`understanding`, `max_understanding`) | alleen simulatie (offset 0xF8 is een gok) | ✅ gelezen en gemaximaliseerd (8 nov 2026) |
| MSVC-RTTI | n.v.t. | ✅ testdata én live (census, opstellingen) |
| Game Pass / Xbox-app (0.9.2409.0) | n.v.t. | alleen simulatie (build, datum, staflijst, kalender); posities van FMLibreEditor |

Mac arm64, Steam-build 26577676 (12 nov 2026, Ajax-save 25 juli 2027, `scratchpad/livetest.py`-achtige reeks via
`fm27-trainer agent`): club, selectie (30), kalender (108 weken), clubs, tactisch begrip (offset 0xF8 leest
plausibele waarden), datum ✅; `set_finances` +1, `inspire` (17→20), `set_week` (één dag), elk met `undo` en exact
terug ✅; `heal` zonder geblesseerden (niets te doen); `sell`/`buy`/`max_understanding` alleen `dry_run`. Windows
op de nieuwe builds: **nog niet live getest**. Dezelfde reeks is herhaald met de release-binaries van 0.2.4; de
opdracht `discover` vond daar in 64 ms exact de adressen van het profiel (`same: true`).

## Taak 1: Windows live controleren — gedaan (8 nov 2026)

Alle stappen hieronder zijn op Steam-build 26340721 doorlopen en groen: lezen klopte met FM (club, saldo, budgetten,
datum, selectie, kalender), en `set_finances`, `inspire`, `heal`, `set_week` en `sell` (dry run én één echte
verkoop) werkten elk met `undo`. Gevonden en opgelost: de RTTI-zoeker keek alleen in `.data`/`.rdata` (ingepakte
DLL, zie boven) waardoor verkopen faalde, en de debug-build was ~40x te traag. Na een FM-patch (build onbekend:
`known_build false`) dezelfde procedure opnieuw doen.

Gebruik een test-save. Start FM27 via Steam, laad de save, dan:

```
cargo build -p fm27-trainer
python -i tools\research\fmq.py
>>> q({"cmd":"ping"})            # build moet PE-6AE565AF-1821C000 zijn, known_build false
>>> q({"cmd":"club"})            # naam, saldo, budgetten: vergelijk met FM (FM toont euro's: pond × ~1,17)
>>> q({"cmd":"squad"})           # namen, moraal, conditie, blessures, waarde, contract
>>> q({"cmd":"game_date"})       # moet de datum in FM zijn
>>> q({"cmd":"training_weeks"})  # maandagen 7 dagen uit elkaar, codes zoals FM's kalender
```

Klopt alles, sta schrijven toe (`q({"cmd":"allow_untested","on":True})`) en test, telkens met `undo` erachteraan en
controle in FM: `set_finances` (transferbudget +1), `inspire` voor één speler, `heal`, `set_week` voor één dag in de
toekomst, `sell` met `dry_run`, daarna één echte verkoop + `undo`. Werkt alles: zet `writes_tested: true` voor de
Windows-build in `BUILDS`, noteer in welke afstand het trainingsblok gevonden werd (`State.training_block`; zo
nodig `TB_WEEKS` per platform maken), werk docs/TECHNICAL.md en de README bij, en vraag of er een release moet komen.

Gaat iets mis: kijk met `census`, `describe`, `refs` waar het verschilt; vergelijk met FMLibreEditor's
`profiles/fm27/layout.toml`.

## Taak 2: transferbiedingen (zie docs/research/fm27-transfer-offers.md)

De wens van de gebruiker: in de app zeggen "verkoop speler X aan club Y voor Z" en dan komt er in FM een **echt bod**.

Bekend (macOS): een bod is `FULL_TRANSFER_OFFER` (0xD0 bytes, uit een pool), alle biedingen staan in
`TRANSFER_MANAGER+0x08` (bodnummer = index). FM toont een bod alleen via zijn inbox-bericht `TRANSFER_OFFER_NEWS`
(groot object, ~40 verwijzingen, in een nieuwsstroom zonder lijst) en een detailrecord met totaalsom, bodnummer,
volgnummer en bonussen. Een bod zonder bericht is onzichtbaar en wordt niet afgehandeld (getest).

Opties, met de gebruiker gekozen route nog open:
- **A. Een binnenkomend bod ombouwen** (koper, speler, som) in bod + detailrecord + beide kopieën van het bericht,
  daarna in FM accepteren → FM doet een echte transfer. Volgende stap: met een vers bod in een test-save alle velden
  van het bericht en het detailrecord in kaart brengen (op Windows eerst de offsets van het bod controleren:
  `tools/research/offers.py`).
- **B. Direct verkopen** (gebouwd, `sell`): betrouwbaar maar zonder bericht/historie.
- **C. FM zelf laten bieden**: transferlijst + vraagprijs + koper meer budget geven.

FM27 gebruikt nepnamen voor clubs zonder licentie: AC Milan = **Casciavit Milano** (UID 1099), Inter =
**Blu-neri Milano** (UID 1135). Handig voor het zoekveld in de app (aliassen?).

## Schermuitlezing (Breakdown) op Windows, gemeten 8 nov 2026

- Elke taartmeter heeft **10 segmenten**, gevuld met de klok mee vanaf 12 uur; het lege deel is **bijna wit**
  (s < 0,25, v > 0,66), de spaken zijn ook licht, de achtergrond van een gemarkeerde rij is middelgrijs
  (s ≈ 0,12, v ≈ 0,34) en viel vroeger onder "meter-grijs". De score is nu het aantal gevulde segmenten × 10
  (laatste echt gekleurde sector, afgerond op een segment); de tint (oranje laag, geel midden, groen hoog) wordt
  alleen bewaard. Balken: 11 plekken, één gekleurde (de stand) en één witte streep; stand = plek vanaf het
  eerste streepje / 10. De doorschijnende paneelachtergrond kan een deel van de streepjes in ruis zetten.
- Windows-OCR leest "Player Buy-In" als "Player Buy-ln" (alias in `model.rs`).
- **Sinds 9 nov 2026** (melding: "Build Up-ring niet half vol, app zegt 70"): een taart wordt uitgesneden als de
  aaneengesloten rijen rond het midden van het label (een buurmeter in de zoekband telt niet meer mee; met grotere
  tekst, tekst/rij ≥ 0,7, las de oude code 7 segmenten als 80 of 50), alleen pixels in de tint van de vulling tellen
  (meest voorkomende tint in de binnenring, ±25°), en FM's kleur is een controle: 20–40 % oranje (~43°), 50–70 % geel
  (~60°), 90 % groen (~120°), 40 % was bij Ajax geel. Valt een meting buiten de band van zijn kleur, dan wordt hij
  naar de rand gezet en gemarkeerd (`GaugeReading.doubt`; de app vraagt de gebruiker hem na te kijken). Tests:
  `pies_on_any_background`, `pies_in_tight_rows` in `vision.rs`. Op Sem's eigen opnames (Ajax, Sunderland) lazen oud
  en nieuw alles goed, ook verkleind tot 1366×768: de opname van de gebruiker is nooit gezien. Vraag bij een nieuwe
  melding om `last-breakdown.png` (Instellingen → "Open app-map").
- **Resolutie-onafhankelijk sinds 8 nov 2026** (melding van een gebruiker: "Read 8 of 17 gauges", key factors
  op 0 of 50): `analyze_image` leest eerst op ware grootte en, als de labels niet ~20 px hoog zijn (`REF_TEXT`,
  de maat van 2560×1440 op 100 %), nog eens op een kopie die naar die maat is geschaald (zonder enig herkend
  label: 1,5× en 2×); de meting op de referentiemaat wint bij gelijke stand. Verder: labels worden tolerant
  gematcht (Levenshtein, ~1 letter per 6), een gemist label krijgt zijn rij uit de rij-afstand en de
  meterkolom van de gevonden labels, en een kolom zonder enig label uit de kop "Key Factors" (eerste rij
  2,15 × kophoogte eronder, meter = laatste ronde blok op de rij). Elke taartmeter wordt vóór het meten naar
  72 px gebracht; de vulling is de aaneengesloten reeks gekleurde sectoren vanaf 12 uur (één sector gat =
  spaak). De balkmeters worden gelezen als helderheidspieken (streepjes) met de kaderrand eruit (kolommen die
  over meer dan 60 % van de hoogte licht zijn); de stand = plek van de gekleurde streep tussen eerste en laatste
  streepje × 10. Getest door `last-breakdown.png` met Pillow te verkleinen naar 3840×2160 … 1280×720: alle 21
  waarden gelijk van 1366×768 tot 4K; op 720p (sterk vervaagd) 15 van 17. `FM27_VISION_DEBUG=1` print de
  balkmeting.
- **Sinds 9 nov 2026 (avond, versie 0.2.4)**, na "nog steeds 8 van 17, eerste 8 op 0, balken
  90/100/100/80" en "leest helemaal niets, moet FM in het Engels?": de labels van alle FM-talen (Arabisch niet;
  US English heeft "Coaching Support" en "Head Coach Tendencies"), matching op alleen letters (spaties/accenten
  eruit, CJK-OCR heeft geen spaties), titels eerst (Duits: Player Ability = Player Capability = "Spielerfähigkeit"),
  een label is minstens de helft van zijn regel. Een taart moet een dichte, ronde schijf zijn (een letter "Q" of
  het icoon vóór het label werd als lege meter = 0 gelezen); 0 wordt altijd gemarkeerd. Als de OCR de taart als
  "O" aan het label plakt, komt het label-einde uit de mediane letterbreedte. "Licht" is relatief aan de
  achtergrond (op een donkere opname stond elke balk op 90–100 doordat de kaderrand als streepje telde; nu
  telt de regelmaat van de streepjes); "gekleurd" moet ook 0,2 lichter zijn dan de achtergrond, en minder
  verzadigde pixels in de tint van de vulling tellen mee (flets HDR). Een balk wordt ook gelezen als zijn titel
  niet herkend is (op de rij van de andere titels, in het eigen paneel). De opname neemt op Windows het venster
  van fm.exe (op pid), nooit een browser (die met een FM-pagina open even groot kan zijn). De OCR valt terug op
  andere talen (Windows: geïnstalleerde OCR-talen; Mac: Vision's talen via `recognitionLanguages`, niet live
  getest). Elke uitlezing schrijft `last-analysis.txt`; de app vraagt erom bij een onvolledige uitlezing.
  Getest met `tools/research/vision_regress.py` op Sem's opname: 18 van 18 varianten goed (0.2.3 las van een
  bredere set van 27 er 7 goed, 0.2.4 23). De echte opname van de melders is nog steeds niet gezien: of dit hun
  oorzaak was, is niet bevestigd.
- Elke uitlezing bewaart `last-capture.png`, `last-analysis.txt` en, als er een Breakdown op stond,
  `last-breakdown.png` in `%APPDATA%\FM27 Trainer`; naspelen met `target\debug\fm27-trainer.exe analyze <png> --ocr`
  (die uitvoer is gelijk aan `last-analysis.txt`). Hulpscripts om
  pixels te bekijken stonden in de scratchpad van de sessie (pie_debug.py, montage.py); zo nodig opnieuw maken
  met Pillow (`python -m pip install --user pillow`).

## Overig

- Ondertekenen Mac: Developer ID "Sem Hiel (SFV4V5SHM4)", notarytool-profiel `fm27-notary` (alleen op de Mac).
- De Windows-exe is niet ondertekend (SmartScreen: "Meer info → Toch uitvoeren").
- Testhulpen GUI: `FM27_PAGE=training|planning|club|squad|sell|settings`, `FM27_LANG=nl|en`,
  `FM27_SNAPSHOT=pad.png` (schermafbeelding van het eigen venster, dan afsluiten), `FM27_WINDOW=1320x1000`.
  Met `FM27_SNAPSHOT` slaat de app het automatisch bijhouden van training over (sinds 8 nov 2026): een testopname
  schrijft nooit in FM. Zonder die variabele schrijft een gestarte app met "automatisch bijhouden" aan binnen
  enkele seconden het trainingsplan in FM; houd daar rekening mee bij tests tegen een echte save.

## Donaties (17 nov 2026)

- Ko-fi-pagina van Sem: `https://ko-fi.com/semhiel` (PayPal/Stripe op 17 nov nog niet gekoppeld). De link staat in
  `.github/FUNDING.yml`, de README ("Support"), de sortitoutsi-post (kopje "Support" boven "Credits") en in de app
  (Instellingen → "Steun de ontwikkeling", `DONATE_URL` in `app/src/gui.rs`; komt mee in de versie ná 0.2.8).
  In sortitoutsi's voorwaarden stond niets over donatielinks.

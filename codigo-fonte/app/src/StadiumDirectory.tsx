import { useState } from "react";
import { ListBrowser } from "./ListBrowser";
import { ProfileFrame, useProfileDetails } from "./ProfileParts";
import { StadiumEditor, useStadiumDetails } from "./StadiumEditor";
import { formatNumber } from "./format";
import type { StadiumPlace } from "./stadiumFields";
import type { ClubDetails, ClubSummary } from "./types";
import { useProfileEditing } from "./useProfileEditing";

type StadiumRow = ClubSummary & StadiumPlace;

function StadiumProfile({ club, version, onClose, onBack }: {
  club: StadiumRow;
  version: number;
  onClose: () => void;
  onBack: () => void;
}) {
  const loaded = useProfileDetails<ClubDetails>("club_details", club.uid, version);
  const metadata = useStadiumDetails(club.uid, version);
  const details = loaded?.details;
  const stadium = details?.stadium ?? null;
  const editing = useProfileEditing("club", club.uid, version, stadium?.key);
  const city = metadata?.details?.city ?? club.city;
  const country = metadata?.details?.country ?? club.country;
  const place = [city, country].filter(Boolean).join(" · ");

  return <ProfileFrame fullName={null} name={stadium?.name ?? club.stadiumName}
    meta={place || undefined}
    vitals={[stadium && `${formatNumber(stadium.capacity)} lugares`, club.name]}
    loaded={loaded} editing={editing} onClose={onClose} onBack={onBack} wide>
    {details && <StadiumEditor club={details} stadium={stadium} details={metadata?.details}
      loading={!metadata} error={metadata?.error} />}
  </ProfileFrame>;
}

const stadiumLabel = (club: StadiumRow) => club.stadiumName;

export function StadiumDirectory({ version, active }: { version: number; active: boolean }) {
  const [visited, setVisited] = useState(false);
  if (active && !visited) setVisited(true);
  if (!active && !visited) return null;

  return <ListBrowser<StadiumRow> fullPage rowLabel={stadiumLabel} name="stadiums" command="search_stadiums"
    version={version} active={active}
    placeholder="Buscar estádio por nome, ID, cidade, país ou clube"
    summary={(total, shown) => total > shown ? `${formatNumber(total)} estádios · primeiros ${shown}` : `${total} estádios encontrados`}
    empty={() => "Nenhum estádio encontrado."}
    scope={<p className="directory-note">Estádios identificados nos clubes da carreira. A busca por ID e cidade depende do perfil do jogo.</p>}
    tableClass="stadium-grid"
    header={<><th>Estádio</th><th>Clube associado</th><th>Localização</th><th className="num">ID do estádio</th></>}
    cells={club => <><td className="name">{club.stadiumName}</td><td>{club.name}</td>
      <td>{[club.city, club.country].filter(Boolean).join(" · ") || "—"}</td>
      <td className="num">{club.stadiumUid ?? "—"}</td></>}
    profile={(club, panel) => <StadiumProfile club={club} {...panel} />}
  />;
}

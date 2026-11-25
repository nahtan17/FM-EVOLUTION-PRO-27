import { useEffect, useId, useState } from "react";
import { call } from "./api";
import { positionLabel, profileText, scoutingText } from "./labels";
import { roleName } from "./ScoutParts";
import type { Phase, Role, ScoutPosition } from "./types";

type RoleCatalog = [ScoutPosition[], Role[]];
let catalogRequest: Promise<RoleCatalog> | undefined;

export const roleImportance = (role: Pick<Role, "keyAttributes" | "otherAttributes"> | undefined, key: string) =>
  role?.keyAttributes.includes(key) ? "essential" : role?.otherAttributes.includes(key) ? "secondary" : undefined;

export function RoleLegend({ secondary = true }: { secondary?: boolean }) {
  return (
    <span className="role-legend">
      <span data-role-sample="essential">Essencial</span>
      {secondary && <span data-role-sample="secondary">Secundário</span>}
    </span>
  );
}

export function useRoleCatalog(enabled = true) {
  const [catalog, setCatalog] = useState<RoleCatalog>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    setFailed(false);
    catalogRequest ??= call<RoleCatalog>("profile_role_catalog").catch((error) => {
      catalogRequest = undefined;
      throw error;
    });
    let active = true;
    catalogRequest.then(
      (data) => { if (active) setCatalog(data); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [enabled]);
  return { catalog, failed };
}

export function usePlayerRoleGuide(preferred: readonly string[]) {
  const { catalog, failed } = useRoleCatalog();
  const [position, setPosition] = useState("");
  const [roleId, setRoleId] = useState("");
  const [positions, roles] = catalog ?? [[], []];
  const defaultPosition = preferred.find((key) => positions.some((item) => item.key === key));
  const selectedPosition = positions.find((item) => item.key === (position || defaultPosition)) ?? positions[0];
  const choices = roles.filter((role) => selectedPosition?.lines.includes(role.line));
  const selected = choices.find((role) => roleValue(role) === roleId);

  return {
    positions,
    selectedPosition,
    choices,
    selected,
    failed,
    ready: !!catalog,
    choosePosition: (key: string) => {
      setPosition(key);
      setRoleId("");
    },
    chooseRole: setRoleId,
  };
}

export function roleValue(role: Role) {
  return [role.phase, role.key].join(":");
}

const PHASES: Phase[] = ["inPossession", "outOfPossession"];

export function PlayerRoleGuide({ guide }: { guide: ReturnType<typeof usePlayerRoleGuide> }) {
  const id = useId();
  if (guide.failed) return <p role="status" className="note">O catálogo de funções está indisponível.</p>;
  return (
    <div className="profile-role-guide" role="group" aria-label="Destaques dos atributos por função">
      <div className="role-picker">
        <label htmlFor={id + "-position"}>{scoutingText.brief.pitch}</label>
        <select id={id + "-position"} value={guide.selectedPosition?.key ?? ""} disabled={!guide.ready}
          onChange={(event) => guide.choosePosition(event.currentTarget.value)}>
          {guide.positions.map(({ key }) => <option key={key} value={key}>{positionLabel(key)}</option>)}
        </select>
      </div>
      <div className="role-picker">
        <label htmlFor={id + "-role"}>Função de referência</label>
        <select id={id + "-role"} value={guide.selected ? roleValue(guide.selected) : ""} disabled={!guide.ready}
          onChange={(event) => guide.chooseRole(event.currentTarget.value)}>
          <option value="">{guide.ready ? "Sem destaques" : profileText.loading}</option>
          {PHASES.map((phase) => (
            <optgroup key={phase} label={scoutingText.brief[phase]}>
              {guide.choices.filter((role) => role.phase === phase).map((role) => (
                <option key={roleValue(role)} value={roleValue(role)}>{roleName(role.key)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {guide.selected && <RoleLegend />}
    </div>
  );
}

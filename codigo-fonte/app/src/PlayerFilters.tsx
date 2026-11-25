import type { ReactNode } from "react";
import { AdvancedPlayerControls, NO_ADVANCED_FIELDS, toAdvancedFilter, type AdvancedFields } from "./AdvancedPlayerFilters";
import { AttributeFilters, PLAYER_ATTRIBUTES } from "./AttributeFilters";
import {
  AbilityInput,
  AgeInputs,
  CheckInput,
  ContractEndInput,
  countPersonFilters,
  FilterBar,
  GenderInput,
  NO_PERSON_FILTERS,
  TextInput,
  toPersonFilter,
  type PersonFilterFields,
} from "./FilterBar";
import { playerListText } from "./labels";
import type { PlayerFilter } from "./types";

const text = playerListText.filters;

/** What the filter inputs hold, as typed: an empty string, or `false`, is no filter. */
export interface PlayerFilterFields extends PersonFilterFields {
  advanced: AdvancedFields;
  freeAgents: boolean;
  transferListed: boolean;
  loanListed: boolean;
}

export const NO_PLAYER_FILTERS: PlayerFilterFields = {
  ...NO_PERSON_FILTERS,
  advanced: NO_ADVANCED_FIELDS,
  freeAgents: false,
  transferListed: false,
  loanListed: false,
};

export function toPlayerFilter(fields: PlayerFilterFields): PlayerFilter | undefined {
  const filter: PlayerFilter = {
    ...toPersonFilter(fields),
    advanced: toAdvancedFilter(fields.advanced),
    freeAgents: fields.freeAgents || undefined,
    transferListed: fields.transferListed || undefined,
    loanListed: fields.loanListed || undefined,
  };
  return countFilters(filter) > 0 ? filter : undefined;
}

export function countFilters(filter: PlayerFilter | undefined): number {
  if (!filter) return 0;
  const single = [filter.freeAgents, filter.transferListed, filter.loanListed].filter(value => value).length;
  const advanced = filter.advanced ? Object.keys(filter.advanced)
    .filter(key => key !== "allPositions" && key !== "positionRating").length : 0;
  return single + countPersonFilters(filter) + advanced;
}

interface PlayerFilterBarProps {
  fields: PlayerFilterFields;
  onChange: (fields: PlayerFilterFields) => void;
  onClear: () => void;
  active: number;
  genderKnown: boolean;
  actions?: ReactNode;
}

export function PlayerFilterBar({ fields, onChange, onClear, active, genderKnown, actions }: PlayerFilterBarProps) {
  const set = <K extends keyof PlayerFilterFields>(key: K, value: PlayerFilterFields[K]) =>
    onChange({ ...fields, [key]: value });
  const input = <K extends keyof PlayerFilterFields>(key: K) => ({
    value: fields[key],
    onChange: (value: PlayerFilterFields[K]) => set(key, value),
  });

  return (
    <FilterBar label="Busca avançada" active={active} onClear={onClear} actions={actions}>
      <AdvancedPlayerControls fields={fields.advanced} onChange={value => set("advanced", value)} basic={{
        general: <>
          {genderKnown && <GenderInput {...input("gender")} />}
          <AgeInputs min={input("minAge")} max={input("maxAge")} />
          <TextInput label={text.nation} {...input("nation")} />
          <TextInput label={text.club} {...input("club")} />
        </>,
        ability: <>
          <AbilityInput label={text.minCurrentAbility} title={text.minCurrentAbilityTitle} {...input("minCurrentAbility")} />
          <AbilityInput label={text.minPotentialAbility} title={text.minPotentialAbilityTitle} {...input("minPotentialAbility")} />
          <AttributeFilters rows={fields.attributes} choices={PLAYER_ATTRIBUTES} onChange={rows => set("attributes", rows)} />
        </>,
        contract: <>
          <CheckInput label={text.freeAgentsOnly} {...input("freeAgents")} />
          <CheckInput label={text.transferListedOnly} {...input("transferListed")} />
          <CheckInput label={text.loanListedOnly} {...input("loanListed")} />
          <ContractEndInput {...input("contractExpiresBy")} />
        </>,
        profile: null,
      }} />
    </FilterBar>
  );
}

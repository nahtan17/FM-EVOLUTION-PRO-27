import { createContext } from "react";

export interface EntityTab {
  id: string;
  list: string;
  label: string;
  activate: () => void;
  close: () => void;
}

export const EntityTabsContext = createContext<{
  active: string | null;
  returnToList: (id: string) => void;
  open: (tab: EntityTab) => void;
  remove: (id: string) => void;
} | null>(null);

import { invoke } from "@tauri-apps/api/core";

/** True inside the Tauri app; false in a plain browser, where fixtures stand in for the game. */
export const inTauri = "__TAURI_INTERNALS__" in window;

/** Calls a Rust command, or its fixture stand-in when the UI runs in a plain browser. */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (inTauri) {
    return invoke<T>(command, args);
  }
  if (command === "trainer_call") {
    const { mockTrainer } = await import("./dev/mockTrainer");
    return await mockTrainer(args?.request as Record<string, unknown>) as T;
  }
  if (["development_status", "development_set", "development_preview"].includes(command)) {
    const { mockDevelopment } = await import("./dev/mockTrainer");
    return mockDevelopment(command, args) as T;
  }
  if (command === "development_validate_settings") return args?.settings as T;
  if (command === "club_finance_history") return {profile: null, rows: []} as T;
  if (command === "club_loan_portfolio") return {loans: [], unread: 0} as T;
  if (["transfer_center","preview_transfer_deal","apply_transfer_deal","club_extra_view","set_club_extra","sponsor_editor","set_sponsor","rating_context"].includes(command)) {
    const {mockToolsV4}=await import("./dev/mockToolsV4");
    return await mockToolsV4(command,args) as T;
  }
  if (["club_records", "set_club_record", "club_statements"].includes(command)) {
    const { mockClubRecords } = await import("./dev/mockClubRecords");
    return mockClubRecords(command, args) as T;
  }
  if (command === "undo_change") {
    const { mockRecordsUndo } = await import("./dev/mockClubRecords");
    const clubRecord = mockRecordsUndo(Number(args?.id));
    if (clubRecord !== undefined) return clubRecord as T;
    const {mockV4Undo}=await import("./dev/mockToolsV4");const result=mockV4Undo(Number(args?.id));if(result!==undefined)return result as T;
  }
  if (["club_care_status","club_care_set","club_tactical_summary","club_cohesion_watch"].includes(command)) {
    const {mockClubCare}=await import("./dev/mockClubCare");
    return await mockClubCare(command,args) as T;
  }
  const { mockInvoke } = await import("./dev/mock");
  return mockInvoke<T>(command, args);
}

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const investigationState = sqliteTable("investigation_state", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  selectedClaimId: text("selected_claim_id").notNull(),
  debtStatus: text("debt_status").notNull().default("proposed"),
  reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});


export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "approvals": {
                  Row: {
                    "actor_id": string,"artifact_id": string,"artifact_version_id": string,"comment": string | null,"created_at": string,"decision": string,"id": string,"seq": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"artifact_id": string,"artifact_version_id": string,"comment"?: string | null,"created_at"?: string,"decision": string,"id"?: string,"seq"?: never,"workspace_id": string
                  }
                  Update: {
                    "actor_id"?: string,"artifact_id"?: string,"artifact_version_id"?: string,"comment"?: string | null,"created_at"?: string,"decision"?: string,"id"?: string,"seq"?: never,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "approvals_artifact_id_artifact_version_id_fkey"
      columns: ["artifact_id","artifact_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["artifact_id","id"]
    },{
      foreignKeyName: "approvals_workspace_id_artifact_id_fkey"
      columns: ["workspace_id","artifact_id"]
isOneToOne: false
      referencedRelation: "artifacts"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"artifact_version_refs": {
                  Row: {
                    "company_profile_version_id": string | null,"created_at": string,"from_version_id": string,"id": string,"project_id": string,"ref_kind": string,"source_asset_id": string | null,"to_version_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_profile_version_id"?: string | null,"created_at"?: string,"from_version_id": string,"id"?: string,"project_id": string,"ref_kind": string,"source_asset_id"?: string | null,"to_version_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "company_profile_version_id"?: string | null,"created_at"?: string,"from_version_id"?: string,"id"?: string,"project_id"?: string,"ref_kind"?: string,"source_asset_id"?: string | null,"to_version_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "artifact_version_refs_company_profile_version_id_fkey"
      columns: ["company_profile_version_id"]
isOneToOne: false
      referencedRelation: "company_profile_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artifact_version_refs_source_asset_id_fkey"
      columns: ["source_asset_id"]
isOneToOne: false
      referencedRelation: "source_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artifact_version_refs_workspace_id_from_version_id_fkey"
      columns: ["workspace_id","from_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "artifact_version_refs_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "artifact_version_refs_workspace_id_to_version_id_fkey"
      columns: ["workspace_id","to_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"artifact_versions": {
                  Row: {
                    "artifact_id": string,"content": NonNullable<Json>,"created_at": string,"created_by": string | null,"generator": string,"id": string,"input_snapshot_id": string | null,"model_id": string | null,"template_id": string | null,"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artifact_id": string,"content": NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"generator": string,"id"?: string,"input_snapshot_id"?: string | null,"model_id"?: string | null,"template_id"?: string | null,"version": number,"workspace_id": string
                  }
                  Update: {
                    "artifact_id"?: string,"content"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"generator"?: string,"id"?: string,"input_snapshot_id"?: string | null,"model_id"?: string | null,"template_id"?: string | null,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "artifact_versions_input_snapshot_id_fkey"
      columns: ["input_snapshot_id"]
isOneToOne: false
      referencedRelation: "task_input_snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artifact_versions_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artifact_versions_workspace_id_artifact_id_fkey"
      columns: ["workspace_id","artifact_id"]
isOneToOne: false
      referencedRelation: "artifacts"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"artifacts": {
                  Row: {
                    "approved_version_id": string | null,"created_at": string,"current_draft_version_id": string | null,"id": string,"project_id": string,"revision": number,"task_id": string,"type": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_version_id"?: string | null,"created_at"?: string,"current_draft_version_id"?: string | null,"id"?: string,"project_id": string,"revision"?: number,"task_id": string,"type": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "approved_version_id"?: string | null,"created_at"?: string,"current_draft_version_id"?: string | null,"id"?: string,"project_id"?: string,"revision"?: number,"task_id"?: string,"type"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "artifacts_id_approved_version_id_fkey"
      columns: ["id","approved_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["artifact_id","id"]
    },{
      foreignKeyName: "artifacts_id_current_draft_version_id_fkey"
      columns: ["id","current_draft_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["artifact_id","id"]
    },{
      foreignKeyName: "artifacts_project_id_task_id_fkey"
      columns: ["project_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "artifacts_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"audit_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"details": NonNullable<Json>,"entity_id": string,"entity_type": string,"id": string,"occurred_at": string,"revision": number | null,"seq": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"details"?: NonNullable<Json>,"entity_id": string,"entity_type": string,"id"?: string,"occurred_at"?: string,"revision"?: number | null,"seq"?: never,"workspace_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"details"?: NonNullable<Json>,"entity_id"?: string,"entity_type"?: string,"id"?: string,"occurred_at"?: string,"revision"?: number | null,"seq"?: never,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"brief_copy_runs": {
                  Row: {
                    "accepted_at": string | null,"accepted_variant": number | null,"brief_id": string,"brief_revision": number,"claim_ids": (string)[],"cost_estimate_usd_micro": number,"cost_usd_micro": number | null,"created_at": string,"created_by": string,"error_code": string | null,"finished_at": string | null,"id": string,"input_hash": string,"input_tokens": number | null,"model": string,"output_tokens": number | null,"problems": Json | null,"provider": string,"status": string,"variants": Json | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_variant"?: number | null,"brief_id": string,"brief_revision": number,"claim_ids"?: (string)[],"cost_estimate_usd_micro": number,"cost_usd_micro"?: number | null,"created_at"?: string,"created_by": string,"error_code"?: string | null,"finished_at"?: string | null,"id"?: string,"input_hash": string,"input_tokens"?: number | null,"model": string,"output_tokens"?: number | null,"problems"?: Json | null,"provider": string,"status"?: string,"variants"?: Json | null,"workspace_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_variant"?: number | null,"brief_id"?: string,"brief_revision"?: number,"claim_ids"?: (string)[],"cost_estimate_usd_micro"?: number,"cost_usd_micro"?: number | null,"created_at"?: string,"created_by"?: string,"error_code"?: string | null,"finished_at"?: string | null,"id"?: string,"input_hash"?: string,"input_tokens"?: number | null,"model"?: string,"output_tokens"?: number | null,"problems"?: Json | null,"provider"?: string,"status"?: string,"variants"?: Json | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "brief_copy_runs_workspace_id_brief_id_fkey"
      columns: ["workspace_id","brief_id"]
isOneToOne: false
      referencedRelation: "content_briefs"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"description": string | null,"id": string,"industry": string | null,"name": string,"revision": number,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"industry"?: string | null,"name": string,"revision"?: number,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"industry"?: string | null,"name"?: string,"revision"?: number,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"company_profile_approvals": {
                  Row: {
                    "actor_id": string,"client_id": string,"comment": string | null,"company_profile_version_id": string,"created_at": string,"decision": string,"id": string,"seq": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"client_id": string,"comment"?: string | null,"company_profile_version_id": string,"created_at"?: string,"decision": string,"id"?: string,"seq"?: never,"workspace_id": string
                  }
                  Update: {
                    "actor_id"?: string,"client_id"?: string,"comment"?: string | null,"company_profile_version_id"?: string,"created_at"?: string,"decision"?: string,"id"?: string,"seq"?: never,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_profile_approvals_client_id_company_profile_versio_fkey"
      columns: ["client_id","company_profile_version_id"]
isOneToOne: false
      referencedRelation: "company_profile_versions"
      referencedColumns: ["client_id","id"]
    },{
      foreignKeyName: "company_profile_approvals_workspace_id_client_id_fkey"
      columns: ["workspace_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"company_profile_versions": {
                  Row: {
                    "audience": string | null,"brand_rules": string | null,"channel_urls": (string)[],"client_id": string,"created_at": string,"id": string,"products": string | null,"source_refs": NonNullable<Json>,"strengths": (string)[],"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: string | null,"brand_rules"?: string | null,"channel_urls"?: (string)[],"client_id": string,"created_at"?: string,"id"?: string,"products"?: string | null,"source_refs"?: NonNullable<Json>,"strengths"?: (string)[],"version": number,"workspace_id": string
                  }
                  Update: {
                    "audience"?: string | null,"brand_rules"?: string | null,"channel_urls"?: (string)[],"client_id"?: string,"created_at"?: string,"id"?: string,"products"?: string | null,"source_refs"?: NonNullable<Json>,"strengths"?: (string)[],"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_profile_versions_workspace_id_client_id_fkey"
      columns: ["workspace_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"content_brief_claims": {
                  Row: {
                    "archived_at": string | null,"brief_id": string,"claim_kind": string,"created_at": string,"created_by": string,"id": string,"position": number,"revision": number,"text": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"brief_id": string,"claim_kind"?: string,"created_at"?: string,"created_by": string,"id"?: string,"position": number,"revision"?: number,"text": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"brief_id"?: string,"claim_kind"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"position"?: number,"revision"?: number,"text"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_brief_claims_workspace_id_brief_id_fkey"
      columns: ["workspace_id","brief_id"]
isOneToOne: false
      referencedRelation: "content_briefs"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"content_briefs": {
                  Row: {
                    "archived_at": string | null,"audience": string | null,"channel": string,"channel_spec": NonNullable<Json>,"copy_draft": string | null,"copy_origin": string,"core_message": string | null,"created_at": string,"created_by": string,"cta": string | null,"funnel_id": string,"funnel_item_id": string,"hook": string | null,"id": string,"image_guide": string | null,"project_id": string,"revision": number,"status": string,"strategy_artifact_id": string,"strategy_version_id": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"audience"?: string | null,"channel": string,"channel_spec"?: NonNullable<Json>,"copy_draft"?: string | null,"copy_origin"?: string,"core_message"?: string | null,"created_at"?: string,"created_by": string,"cta"?: string | null,"funnel_id": string,"funnel_item_id": string,"hook"?: string | null,"id"?: string,"image_guide"?: string | null,"project_id": string,"revision"?: number,"status"?: string,"strategy_artifact_id": string,"strategy_version_id": string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"audience"?: string | null,"channel"?: string,"channel_spec"?: NonNullable<Json>,"copy_draft"?: string | null,"copy_origin"?: string,"core_message"?: string | null,"created_at"?: string,"created_by"?: string,"cta"?: string | null,"funnel_id"?: string,"funnel_item_id"?: string,"hook"?: string | null,"id"?: string,"image_guide"?: string | null,"project_id"?: string,"revision"?: number,"status"?: string,"strategy_artifact_id"?: string,"strategy_version_id"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_briefs_funnel_id_funnel_item_id_fkey"
      columns: ["funnel_id","funnel_item_id"]
isOneToOne: false
      referencedRelation: "funnel_items"
      referencedColumns: ["funnel_id","id"]
    },{
      foreignKeyName: "content_briefs_strategy_artifact_id_strategy_version_id_fkey"
      columns: ["strategy_artifact_id","strategy_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["artifact_id","id"]
    },{
      foreignKeyName: "content_briefs_workspace_id_funnel_id_fkey"
      columns: ["workspace_id","funnel_id"]
isOneToOne: false
      referencedRelation: "funnels"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "content_briefs_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"content_claim_sources": {
                  Row: {
                    "claim_id": string,"company_profile_version_id": string | null,"created_at": string,"created_by": string,"id": string,"kind": string,"note": string | null,"profile_field": string | null,"research_source_id": string | null,"source_asset_id": string | null,"unlinked_at": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "claim_id": string,"company_profile_version_id"?: string | null,"created_at"?: string,"created_by": string,"id"?: string,"kind": string,"note"?: string | null,"profile_field"?: string | null,"research_source_id"?: string | null,"source_asset_id"?: string | null,"unlinked_at"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "claim_id"?: string,"company_profile_version_id"?: string | null,"created_at"?: string,"created_by"?: string,"id"?: string,"kind"?: string,"note"?: string | null,"profile_field"?: string | null,"research_source_id"?: string | null,"source_asset_id"?: string | null,"unlinked_at"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_claim_sources_company_profile_version_id_fkey"
      columns: ["company_profile_version_id"]
isOneToOne: false
      referencedRelation: "company_profile_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_claim_sources_research_source_id_fkey"
      columns: ["research_source_id"]
isOneToOne: false
      referencedRelation: "research_sources"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_claim_sources_source_asset_id_fkey"
      columns: ["source_asset_id"]
isOneToOne: false
      referencedRelation: "source_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_claim_sources_workspace_id_claim_id_fkey"
      columns: ["workspace_id","claim_id"]
isOneToOne: false
      referencedRelation: "content_brief_claims"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"delivery_records": {
                  Row: {
                    "artifact_version_id": string,"created_at": string,"delivered_at": string,"export_id": string | null,"id": string,"method": string,"note": string | null,"project_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artifact_version_id": string,"created_at"?: string,"delivered_at": string,"export_id"?: string | null,"id"?: string,"method": string,"note"?: string | null,"project_id": string,"workspace_id": string
                  }
                  Update: {
                    "artifact_version_id"?: string,"created_at"?: string,"delivered_at"?: string,"export_id"?: string | null,"id"?: string,"method"?: string,"note"?: string | null,"project_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_records_workspace_id_artifact_version_id_fkey"
      columns: ["workspace_id","artifact_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "delivery_records_workspace_id_export_id_fkey"
      columns: ["workspace_id","export_id"]
isOneToOne: false
      referencedRelation: "exports"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "delivery_records_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"exports": {
                  Row: {
                    "artifact_version_id": string,"checksum_sha256": string | null,"created_at": string,"error_code": string | null,"format": string,"id": string,"idempotency_key": string,"mime": string | null,"object_key": string | null,"revision": number,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artifact_version_id": string,"checksum_sha256"?: string | null,"created_at"?: string,"error_code"?: string | null,"format": string,"id"?: string,"idempotency_key": string,"mime"?: string | null,"object_key"?: string | null,"revision"?: number,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "artifact_version_id"?: string,"checksum_sha256"?: string | null,"created_at"?: string,"error_code"?: string | null,"format"?: string,"id"?: string,"idempotency_key"?: string,"mime"?: string | null,"object_key"?: string | null,"revision"?: number,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "exports_workspace_id_artifact_version_id_fkey"
      columns: ["workspace_id","artifact_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"funnel_items": {
                  Row: {
                    "archived_at": string | null,"channel": string | null,"created_at": string,"created_by": string,"description": string | null,"details": Json | null,"funnel_id": string,"id": string,"kind": string,"position": number,"revision": number,"stage_id": string,"status": string,"target_note": string | null,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"channel"?: string | null,"created_at"?: string,"created_by": string,"description"?: string | null,"details"?: Json | null,"funnel_id": string,"id"?: string,"kind": string,"position": number,"revision"?: number,"stage_id": string,"status"?: string,"target_note"?: string | null,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"channel"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"details"?: Json | null,"funnel_id"?: string,"id"?: string,"kind"?: string,"position"?: number,"revision"?: number,"stage_id"?: string,"status"?: string,"target_note"?: string | null,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "funnel_items_funnel_id_stage_id_fkey"
      columns: ["funnel_id","stage_id"]
isOneToOne: false
      referencedRelation: "funnel_stages"
      referencedColumns: ["funnel_id","id"]
    },{
      foreignKeyName: "funnel_items_workspace_id_funnel_id_fkey"
      columns: ["workspace_id","funnel_id"]
isOneToOne: false
      referencedRelation: "funnels"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"funnel_stages": {
                  Row: {
                    "created_at": string,"focus": string | null,"funnel_id": string,"id": string,"position": number,"revision": number,"stage_key": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"focus"?: string | null,"funnel_id": string,"id"?: string,"position": number,"revision"?: number,"stage_key": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"focus"?: string | null,"funnel_id"?: string,"id"?: string,"position"?: number,"revision"?: number,"stage_key"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "funnel_stages_workspace_id_funnel_id_fkey"
      columns: ["workspace_id","funnel_id"]
isOneToOne: false
      referencedRelation: "funnels"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"funnels": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"project_id": string,"revision": number,"strategy_artifact_id": string,"strategy_version_id": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: string,"project_id": string,"revision"?: number,"strategy_artifact_id": string,"strategy_version_id": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"project_id"?: string,"revision"?: number,"strategy_artifact_id"?: string,"strategy_version_id"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "funnels_strategy_artifact_id_strategy_version_id_fkey"
      columns: ["strategy_artifact_id","strategy_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["artifact_id","id"]
    },{
      foreignKeyName: "funnels_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "funnels_workspace_id_strategy_artifact_id_fkey"
      columns: ["workspace_id","strategy_artifact_id"]
isOneToOne: false
      referencedRelation: "artifacts"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"generation_runs": {
                  Row: {
                    "action": string,"artifact_version_id": string | null,"attempt": number,"created_at": string,"error_code": string | null,"finished_at": string | null,"id": string,"idempotency_key": string,"input_hash": string,"mode": string | null,"model_id": string | null,"provider": string | null,"revision": number,"started_at": string | null,"status": string,"task_id": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"artifact_version_id"?: string | null,"attempt"?: number,"created_at"?: string,"error_code"?: string | null,"finished_at"?: string | null,"id"?: string,"idempotency_key": string,"input_hash": string,"mode"?: string | null,"model_id"?: string | null,"provider"?: string | null,"revision"?: number,"started_at"?: string | null,"status"?: string,"task_id": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "action"?: string,"artifact_version_id"?: string | null,"attempt"?: number,"created_at"?: string,"error_code"?: string | null,"finished_at"?: string | null,"id"?: string,"idempotency_key"?: string,"input_hash"?: string,"mode"?: string | null,"model_id"?: string | null,"provider"?: string | null,"revision"?: number,"started_at"?: string | null,"status"?: string,"task_id"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "generation_runs_artifact_version_id_fkey"
      columns: ["artifact_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "generation_runs_workspace_id_task_id_fkey"
      columns: ["workspace_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"project_profiles": {
                  Row: {
                    "client_id": string,"company_profile_version_id": string,"created_at": string,"id": string,"project_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"company_profile_version_id": string,"created_at"?: string,"id"?: string,"project_id": string,"workspace_id": string
                  }
                  Update: {
                    "client_id"?: string,"company_profile_version_id"?: string,"created_at"?: string,"id"?: string,"project_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_profiles_client_id_company_profile_version_id_fkey"
      columns: ["client_id","company_profile_version_id"]
isOneToOne: false
      referencedRelation: "company_profile_versions"
      referencedColumns: ["client_id","id"]
    },{
      foreignKeyName: "project_profiles_project_id_client_id_fkey"
      columns: ["project_id","client_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id","client_id"]
    },{
      foreignKeyName: "project_profiles_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "budget_won": number | null,"client_id": string | null,"created_at": string,"due_at": string | null,"id": string,"kind": string,"revision": number,"status": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "budget_won"?: number | null,"client_id"?: string | null,"created_at"?: string,"due_at"?: string | null,"id"?: string,"kind": string,"revision"?: number,"status"?: string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "budget_won"?: number | null,"client_id"?: string | null,"created_at"?: string,"due_at"?: string | null,"id"?: string,"kind"?: string,"revision"?: number,"status"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_workspace_id_client_id_fkey"
      columns: ["workspace_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "projects_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"quote_items": {
                  Row: {
                    "description": string | null,"id": string,"line_amount_won": number | null,"name": string,"position": number,"quantity_hundredths": number,"quote_version_id": string,"unit_price_won": number | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string | null,"id"?: string,"line_amount_won"?: number | null,"name": string,"position": number,"quantity_hundredths": number,"quote_version_id": string,"unit_price_won"?: number | null,"workspace_id": string
                  }
                  Update: {
                    "description"?: string | null,"id"?: string,"line_amount_won"?: number | null,"name"?: string,"position"?: number,"quantity_hundredths"?: number,"quote_version_id"?: string,"unit_price_won"?: number | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_items_workspace_id_quote_version_id_fkey"
      columns: ["workspace_id","quote_version_id"]
isOneToOne: false
      referencedRelation: "quote_versions"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"quote_number_sequences": {
                  Row: {
                    "last_number": number,"workspace_id": string,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "last_number": number,"workspace_id": string,"year": number
                  }
                  Update: {
                    "last_number"?: number,"workspace_id"?: string,"year"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_number_sequences_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"quote_versions": {
                  Row: {
                    "artifact_id": string,"artifact_version_id": string,"created_at": string,"customer_snapshot": NonNullable<Json>,"id": string,"issue_date": string | null,"notes": string | null,"payment_terms": string | null,"quote_id": string,"subtotal_won": number,"supplier_profile_id": string | null,"supplier_snapshot": NonNullable<Json>,"tax_mode": string,"tax_rate_bp": number,"tax_won": number,"total_won": number,"valid_until": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artifact_id": string,"artifact_version_id": string,"created_at"?: string,"customer_snapshot": NonNullable<Json>,"id"?: string,"issue_date"?: string | null,"notes"?: string | null,"payment_terms"?: string | null,"quote_id": string,"subtotal_won": number,"supplier_profile_id"?: string | null,"supplier_snapshot": NonNullable<Json>,"tax_mode": string,"tax_rate_bp": number,"tax_won": number,"total_won": number,"valid_until"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "artifact_id"?: string,"artifact_version_id"?: string,"created_at"?: string,"customer_snapshot"?: NonNullable<Json>,"id"?: string,"issue_date"?: string | null,"notes"?: string | null,"payment_terms"?: string | null,"quote_id"?: string,"subtotal_won"?: number,"supplier_profile_id"?: string | null,"supplier_snapshot"?: NonNullable<Json>,"tax_mode"?: string,"tax_rate_bp"?: number,"tax_won"?: number,"total_won"?: number,"valid_until"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_versions_artifact_id_artifact_version_id_fkey"
      columns: ["artifact_id","artifact_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["artifact_id","id"]
    },{
      foreignKeyName: "quote_versions_quote_id_artifact_id_fkey"
      columns: ["quote_id","artifact_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id","artifact_id"]
    },{
      foreignKeyName: "quote_versions_workspace_id_supplier_profile_id_fkey"
      columns: ["workspace_id","supplier_profile_id"]
isOneToOne: false
      referencedRelation: "supplier_profiles"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "artifact_id": string,"created_at": string,"id": string,"quote_number": string | null,"task_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artifact_id": string,"created_at"?: string,"id"?: string,"quote_number"?: string | null,"task_id": string,"workspace_id": string
                  }
                  Update: {
                    "artifact_id"?: string,"created_at"?: string,"id"?: string,"quote_number"?: string | null,"task_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_artifact_id_task_id_fkey"
      columns: ["artifact_id","task_id"]
isOneToOne: false
      referencedRelation: "artifacts"
      referencedColumns: ["id","task_id"]
    },{
      foreignKeyName: "quotes_workspace_id_task_id_fkey"
      columns: ["workspace_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"research_sources": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"project_id": string,"publisher": string | null,"quoted_excerpt": string | null,"retrieved_at": string,"review_status": string,"revision": number,"title": string,"updated_at": string,"url": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: string,"project_id": string,"publisher"?: string | null,"quoted_excerpt"?: string | null,"retrieved_at": string,"review_status"?: string,"revision"?: number,"title": string,"updated_at"?: string,"url": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"project_id"?: string,"publisher"?: string | null,"quoted_excerpt"?: string | null,"retrieved_at"?: string,"review_status"?: string,"revision"?: number,"title"?: string,"updated_at"?: string,"url"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "research_sources_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"signup_allowlist": {
                  Row: {
                    "created_at": string,"email": string,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"note"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"note"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"source_assets": {
                  Row: {
                    "bytes": number | null,"checksum_sha256": string | null,"client_id": string | null,"created_at": string,"display_name": string | null,"extraction_status": string,"file_name": string | null,"id": string,"kind": string,"mime": string | null,"object_key": string | null,"project_id": string | null,"review_status": string,"revision": number,"text_content": string | null,"updated_at": string,"upload_status": string,"url": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bytes"?: number | null,"checksum_sha256"?: string | null,"client_id"?: string | null,"created_at"?: string,"display_name"?: never,"extraction_status"?: string,"file_name"?: string | null,"id"?: string,"kind": string,"mime"?: string | null,"object_key"?: string | null,"project_id"?: string | null,"review_status"?: string,"revision"?: number,"text_content"?: string | null,"updated_at"?: string,"upload_status"?: string,"url"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "bytes"?: number | null,"checksum_sha256"?: string | null,"client_id"?: string | null,"created_at"?: string,"display_name"?: never,"extraction_status"?: string,"file_name"?: string | null,"id"?: string,"kind"?: string,"mime"?: string | null,"object_key"?: string | null,"project_id"?: string | null,"review_status"?: string,"revision"?: number,"text_content"?: string | null,"updated_at"?: string,"upload_status"?: string,"url"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "source_assets_project_id_client_id_fkey"
      columns: ["project_id","client_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id","client_id"]
    },{
      foreignKeyName: "source_assets_workspace_id_client_id_fkey"
      columns: ["workspace_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "source_assets_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "source_assets_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"supplier_profiles": {
                  Row: {
                    "address": string | null,"business_number": string | null,"created_at": string,"email": string | null,"extra": NonNullable<Json>,"id": string,"legal_name": string,"phone": string | null,"representative": string | null,"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"business_number"?: string | null,"created_at"?: string,"email"?: string | null,"extra"?: NonNullable<Json>,"id"?: string,"legal_name": string,"phone"?: string | null,"representative"?: string | null,"version": number,"workspace_id": string
                  }
                  Update: {
                    "address"?: string | null,"business_number"?: string | null,"created_at"?: string,"email"?: string | null,"extra"?: NonNullable<Json>,"id"?: string,"legal_name"?: string,"phone"?: string | null,"representative"?: string | null,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_profiles_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"task_input_snapshots": {
                  Row: {
                    "created_at": string,"extra_inputs": NonNullable<Json>,"id": string,"input_hash": string,"profile_snapshot": NonNullable<Json>,"source_version_refs": NonNullable<Json>,"task_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"extra_inputs"?: NonNullable<Json>,"id"?: string,"input_hash": string,"profile_snapshot": NonNullable<Json>,"source_version_refs"?: NonNullable<Json>,"task_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"extra_inputs"?: NonNullable<Json>,"id"?: string,"input_hash"?: string,"profile_snapshot"?: NonNullable<Json>,"source_version_refs"?: NonNullable<Json>,"task_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_input_snapshots_workspace_id_task_id_fkey"
      columns: ["workspace_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "created_at": string,"due_at": string | null,"id": string,"idempotency_key": string,"project_id": string,"revision": number,"role_key": string | null,"status": string,"template_id": string,"type": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"due_at"?: string | null,"id"?: string,"idempotency_key": string,"project_id": string,"revision"?: number,"role_key"?: string | null,"status"?: string,"template_id": string,"type": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"due_at"?: string | null,"id"?: string,"idempotency_key"?: string,"project_id"?: string,"revision"?: number,"role_key"?: string | null,"status"?: string,"template_id"?: string,"type"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_template_id_type_fkey"
      columns: ["template_id","type"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id","type"]
    },{
      foreignKeyName: "tasks_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"templates": {
                  Row: {
                    "active": boolean,"body": string,"created_at": string,"id": string,"input_schema": NonNullable<Json>,"key": string,"output_schema": NonNullable<Json>,"type": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"body"?: string,"created_at"?: string,"id"?: string,"input_schema"?: NonNullable<Json>,"key": string,"output_schema"?: NonNullable<Json>,"type": string,"version": number
                  }
                  Update: {
                    "active"?: boolean,"body"?: string,"created_at"?: string,"id"?: string,"input_schema"?: NonNullable<Json>,"key"?: string,"output_schema"?: NonNullable<Json>,"type"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"currency": string,"id": string,"name": string,"owner_user_id": string,"revision": number,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"currency"?: string,"id"?: string,"name": string,"owner_user_id": string,"revision"?: number,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"currency"?: string,"id"?: string,"name"?: string,"owner_user_id"?: string,"revision"?: number,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_brief_copy":
{ Args: { "p_expected_revision": number,"p_run_id": string,"p_variant": number }; Returns: number
                           },
"add_brief_claim":
{ Args: { "p_brief_id": string,"p_claim_kind"?: string,"p_text": string }; Returns: string
                           },
"add_funnel_item":
{ Args: { "p_channel"?: string,"p_description"?: string,"p_details"?: Json,"p_kind": string,"p_stage_id": string,"p_status"?: string,"p_target_note"?: string,"p_title": string }; Returns: string
                           },
"add_research_source":
{ Args: { "p_project_id": string,"p_publisher"?: string,"p_quoted_excerpt"?: string,"p_retrieved_at": string,"p_title": string,"p_url": string }; Returns: string
                           },
"approve_company_profile_version":
{ Args: { "p_comment"?: string,"p_decision": string,"p_expected_last_seq": number,"p_profile_version_id": string }; Returns: number
                           },
"archive_brief_claim":
{ Args: { "p_claim_id": string,"p_expected_revision": number }; Returns: number
                           },
"archive_content_brief":
{ Args: { "p_brief_id": string,"p_expected_revision": number }; Returns: number
                           },
"archive_funnel_item":
{ Args: { "p_expected_revision": number,"p_item_id": string }; Returns: number
                           },
"assign_quote_number":
{ Args: { "p_issue_date"?: string,"p_quote_id": string }; Returns: string
                           },
"create_content_brief":
{ Args: { "p_audience"?: string,"p_channel": string,"p_channel_spec"?: Json,"p_core_message"?: string,"p_cta"?: string,"p_funnel_item_id": string,"p_title": string }; Returns: {
              "brief_id": string,"reused": boolean
            }[]
                           },
"create_funnel":
{ Args: { "p_strategy_artifact_id": string }; Returns: {
              "funnel_id": string,"reused": boolean
            }[]
                           },
"decide_version":
{ Args: { "p_artifact_id": string,"p_comment"?: string,"p_decision": string,"p_version_id": string }; Returns: undefined
                           },
"finalize_quote":
{ Args: { "p_artifact_id": string,"p_customer_snapshot": Json,"p_issue_date": string,"p_items": Json,"p_notes": string,"p_payment_terms": string,"p_subtotal_won": number,"p_supplier_profile_id": string,"p_supplier_snapshot": Json,"p_tax_mode": string,"p_tax_rate_bp": number,"p_tax_won": number,"p_total_won": number,"p_valid_until": string,"p_version_id": string }; Returns: {
              "quote_id": string,"quote_number": string,"quote_version_id": string,"reused": boolean
            }[]
                           },
"finish_brief_copy_run":
{ Args: { "p_cost_usd_micro": number,"p_error_code": string,"p_input_tokens": number,"p_output_tokens": number,"p_problems": Json,"p_run_id": string,"p_status": string,"p_variants": Json }; Returns: undefined
                           },
"generate_strategy":
{ Args: { "p_content": Json,"p_extra_inputs": Json,"p_idempotency_key": string,"p_profile_version_id": string,"p_task_id": string }; Returns: {
              "artifact_id": string,"reused": boolean,"version": number,"version_id": string
            }[]
                           },
"link_claim_source":
{ Args: { "p_claim_id": string,"p_kind": string,"p_note"?: string,"p_profile_field"?: string,"p_target_id": string }; Returns: string
                           },
"rebase_content_brief":
{ Args: { "p_brief_id": string,"p_expected_revision": number }; Returns: number
                           },
"rebase_funnel":
{ Args: { "p_expected_revision": number,"p_funnel_id": string }; Returns: number
                           },
"record_delivery":
{ Args: { "p_artifact_id": string,"p_delivered_at": string,"p_method": string,"p_note"?: string }; Returns: string
                           },
"record_generation":
{ Args: { "p_content": Json,"p_extra_inputs": Json,"p_idempotency_key": string,"p_input_hash": string,"p_mode": string,"p_profile_snapshot": Json,"p_source_refs": Json,"p_task_id": string }; Returns: {
              "artifact_id": string,"reused": boolean,"version": number,"version_id": string
            }[]
                           },
"reserve_brief_copy_run":
{ Args: { "p_brief_id": string,"p_claim_ids": (string)[],"p_expected_revision": number,"p_input_hash": string,"p_model": string,"p_provider": string }; Returns: {
              "reused": boolean,"run_id": string
            }[]
                           },
"save_draft_version":
{ Args: { "p_content": Json,"p_expected_revision": number,"p_input_hash": string,"p_snapshot": Json,"p_task_id": string }; Returns: {
              "artifact_id": string,"version": number,"version_id": string
            }[]
                           },
"save_manual_version":
{ Args: { "p_artifact_id": string,"p_content": Json,"p_expected_revision": number }; Returns: {
              "version": number,"version_id": string
            }[]
                           },
"save_strategy_manual_version":
{ Args: { "p_artifact_id": string,"p_content": Json,"p_expected_revision": number }; Returns: {
              "version": number,"version_id": string
            }[]
                           },
"set_research_source_review":
{ Args: { "p_expected_revision": number,"p_source_id": string,"p_status": string }; Returns: number
                           },
"setup_workspace":
{ Args: { "p_address"?: string,"p_business_number"?: string,"p_email"?: string,"p_legal_name": string,"p_name": string,"p_phone"?: string,"p_representative"?: string }; Returns: string
                           },
"unlink_claim_source":
{ Args: { "p_source_id": string }; Returns: undefined
                           },
"update_brief_claim":
{ Args: { "p_claim_id": string,"p_claim_kind": string,"p_expected_revision": number,"p_text": string }; Returns: number
                           },
"update_content_brief":
{ Args: { "p_audience": string,"p_brief_id": string,"p_channel_spec": Json,"p_copy_draft": string,"p_copy_origin": string,"p_core_message": string,"p_cta": string,"p_expected_revision": number,"p_hook": string,"p_image_guide": string,"p_status": string,"p_title": string }; Returns: number
                           },
"update_funnel_item":
{ Args: { "p_channel": string,"p_description": string,"p_details": Json,"p_expected_revision": number,"p_item_id": string,"p_kind": string,"p_stage_id": string,"p_status": string,"p_target_note": string,"p_title": string }; Returns: number
                           },
"update_funnel_stage":
{ Args: { "p_expected_revision": number,"p_focus": string,"p_stage_id": string }; Returns: number
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const

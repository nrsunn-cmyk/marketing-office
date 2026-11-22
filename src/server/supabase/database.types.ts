
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin_access_log": {
                  Row: {
                    "admin_id": string,"id": string,"occurred_at": string,"params": NonNullable<Json>,"row_count": number,"rpc": string,"seq": number
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_id": string,"id"?: string,"occurred_at"?: string,"params"?: NonNullable<Json>,"row_count": number,"rpc": string,"seq"?: never
                  }
                  Update: {
                    "admin_id"?: string,"id"?: string,"occurred_at"?: string,"params"?: NonNullable<Json>,"row_count"?: number,"rpc"?: string,"seq"?: never
                  }
                  Relationships: [
                    
                  ]
                },"approvals": {
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
                },"channel_drafts": {
                  Row: {
                    "archived_at": string | null,"body": string,"brief_id": string,"channel": string,"created_at": string,"created_by": string,"id": string,"image_note": string | null,"language": string,"meta_description": string | null,"revision": number,"source_brief_revision": number,"source_snapshot": NonNullable<Json>,"status": string,"strategy_artifact_id": string,"strategy_version_id": string,"tags": NonNullable<Json>,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"body"?: string,"brief_id": string,"channel"?: string,"created_at"?: string,"created_by": string,"id"?: string,"image_note"?: string | null,"language"?: string,"meta_description"?: string | null,"revision"?: number,"source_brief_revision": number,"source_snapshot": NonNullable<Json>,"status"?: string,"strategy_artifact_id": string,"strategy_version_id": string,"tags"?: NonNullable<Json>,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"body"?: string,"brief_id"?: string,"channel"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"image_note"?: string | null,"language"?: string,"meta_description"?: string | null,"revision"?: number,"source_brief_revision"?: number,"source_snapshot"?: NonNullable<Json>,"status"?: string,"strategy_artifact_id"?: string,"strategy_version_id"?: string,"tags"?: NonNullable<Json>,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_drafts_brief_id_strategy_artifact_id_fkey"
      columns: ["brief_id","strategy_artifact_id"]
isOneToOne: false
      referencedRelation: "content_briefs"
      referencedColumns: ["id","strategy_artifact_id"]
    },{
      foreignKeyName: "channel_drafts_strategy_artifact_id_strategy_version_id_fkey"
      columns: ["strategy_artifact_id","strategy_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["artifact_id","id"]
    },{
      foreignKeyName: "channel_drafts_workspace_id_brief_id_fkey"
      columns: ["workspace_id","brief_id"]
isOneToOne: false
      referencedRelation: "content_briefs"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"channel_publications": {
                  Row: {
                    "created_at": string,"created_by": string,"draft_id": string,"id": string,"kind": string,"note": string | null,"published_at": string | null,"url": string | null,"voids_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"draft_id": string,"id"?: string,"kind": string,"note"?: string | null,"published_at"?: string | null,"url"?: string | null,"voids_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"draft_id"?: string,"id"?: string,"kind"?: string,"note"?: string | null,"published_at"?: string | null,"url"?: string | null,"voids_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_publications_draft_id_voids_id_fkey"
      columns: ["draft_id","voids_id"]
isOneToOne: false
      referencedRelation: "channel_publications"
      referencedColumns: ["draft_id","id"]
    },{
      foreignKeyName: "channel_publications_workspace_id_draft_id_fkey"
      columns: ["workspace_id","draft_id"]
isOneToOne: false
      referencedRelation: "channel_drafts"
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
                },"delivery_bundle_items": {
                  Row: {
                    "brief_revision": number | null,"bundle_id": string,"content_sha256": string,"created_at": string,"design_asset_id": string | null,"design_asset_version_id": string | null,"id": string,"kind": string,"ppt_deck_id": string | null,"ppt_deck_version_id": string | null,"production_brief_id": string | null,"project_id": string,"qa_review_id": string | null,"sort_order": number,"version_no": number,"video_plan_id": string | null,"video_plan_version_id": string | null,"web_copy_doc_id": string | null,"web_copy_version_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "brief_revision"?: number | null,"bundle_id": string,"content_sha256": string,"created_at"?: string,"design_asset_id"?: string | null,"design_asset_version_id"?: string | null,"id"?: string,"kind": string,"ppt_deck_id"?: string | null,"ppt_deck_version_id"?: string | null,"production_brief_id"?: string | null,"project_id": string,"qa_review_id"?: string | null,"sort_order": number,"version_no": number,"video_plan_id"?: string | null,"video_plan_version_id"?: string | null,"web_copy_doc_id"?: string | null,"web_copy_version_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "brief_revision"?: number | null,"bundle_id"?: string,"content_sha256"?: string,"created_at"?: string,"design_asset_id"?: string | null,"design_asset_version_id"?: string | null,"id"?: string,"kind"?: string,"ppt_deck_id"?: string | null,"ppt_deck_version_id"?: string | null,"production_brief_id"?: string | null,"project_id"?: string,"qa_review_id"?: string | null,"sort_order"?: number,"version_no"?: number,"video_plan_id"?: string | null,"video_plan_version_id"?: string | null,"web_copy_doc_id"?: string | null,"web_copy_version_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_bundle_items_design_asset_id_design_asset_version_fkey"
      columns: ["design_asset_id","design_asset_version_id"]
isOneToOne: false
      referencedRelation: "design_asset_versions"
      referencedColumns: ["asset_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_ppt_deck_id_ppt_deck_version_id_fkey"
      columns: ["ppt_deck_id","ppt_deck_version_id"]
isOneToOne: false
      referencedRelation: "ppt_deck_versions"
      referencedColumns: ["deck_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_project_id_bundle_id_fkey"
      columns: ["project_id","bundle_id"]
isOneToOne: false
      referencedRelation: "delivery_bundles"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_project_id_design_asset_id_fkey"
      columns: ["project_id","design_asset_id"]
isOneToOne: false
      referencedRelation: "design_assets"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_project_id_ppt_deck_id_fkey"
      columns: ["project_id","ppt_deck_id"]
isOneToOne: false
      referencedRelation: "ppt_decks"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_project_id_production_brief_id_fkey"
      columns: ["project_id","production_brief_id"]
isOneToOne: false
      referencedRelation: "production_briefs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_project_id_qa_review_id_fkey"
      columns: ["project_id","qa_review_id"]
isOneToOne: false
      referencedRelation: "qa_reviews"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_project_id_video_plan_id_fkey"
      columns: ["project_id","video_plan_id"]
isOneToOne: false
      referencedRelation: "video_plans"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_project_id_web_copy_doc_id_fkey"
      columns: ["project_id","web_copy_doc_id"]
isOneToOne: false
      referencedRelation: "web_copy_docs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_video_plan_id_video_plan_version_id_fkey"
      columns: ["video_plan_id","video_plan_version_id"]
isOneToOne: false
      referencedRelation: "video_plan_versions"
      referencedColumns: ["plan_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_web_copy_doc_id_web_copy_version_id_fkey"
      columns: ["web_copy_doc_id","web_copy_version_id"]
isOneToOne: false
      referencedRelation: "web_copy_versions"
      referencedColumns: ["doc_id","id"]
    },{
      foreignKeyName: "delivery_bundle_items_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"delivery_bundles": {
                  Row: {
                    "archived_at": string | null,"bundle_no": number,"created_at": string,"created_by": string,"id": string,"item_count": number,"project_id": string,"restored_from_id": string | null,"revision": number,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"bundle_no": number,"created_at"?: string,"created_by": string,"id"?: string,"item_count": number,"project_id": string,"restored_from_id"?: string | null,"revision"?: number,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"bundle_no"?: number,"created_at"?: string,"created_by"?: string,"id"?: string,"item_count"?: number,"project_id"?: string,"restored_from_id"?: string | null,"revision"?: number,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_bundles_project_id_restored_from_id_fkey"
      columns: ["project_id","restored_from_id"]
isOneToOne: false
      referencedRelation: "delivery_bundles"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "delivery_bundles_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"delivery_logs": {
                  Row: {
                    "bundle_id": string,"created_at": string,"created_by": string,"delivered_at": string,"id": string,"method": string,"note": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bundle_id": string,"created_at"?: string,"created_by": string,"delivered_at": string,"id"?: string,"method": string,"note"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "bundle_id"?: string,"created_at"?: string,"created_by"?: string,"delivered_at"?: string,"id"?: string,"method"?: string,"note"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_logs_workspace_id_bundle_id_fkey"
      columns: ["workspace_id","bundle_id"]
isOneToOne: false
      referencedRelation: "delivery_bundles"
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
                },"design_asset_uploads": {
                  Row: {
                    "asset_id": string | null,"asset_kind": string,"created_at": string,"created_by": string,"decided_at": string | null,"expires_at": string,"file_name": string,"file_size_bytes": number,"id": string,"mime_type": string,"production_brief_id": string,"project_id": string,"reject_reason": string | null,"status": string,"storage_key": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id"?: string | null,"asset_kind": string,"created_at"?: string,"created_by": string,"decided_at"?: string | null,"expires_at": string,"file_name": string,"file_size_bytes": number,"id"?: string,"mime_type": string,"production_brief_id": string,"project_id": string,"reject_reason"?: string | null,"status"?: string,"storage_key": string,"workspace_id": string
                  }
                  Update: {
                    "asset_id"?: string | null,"asset_kind"?: string,"created_at"?: string,"created_by"?: string,"decided_at"?: string | null,"expires_at"?: string,"file_name"?: string,"file_size_bytes"?: number,"id"?: string,"mime_type"?: string,"production_brief_id"?: string,"project_id"?: string,"reject_reason"?: string | null,"status"?: string,"storage_key"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "design_asset_uploads_project_id_asset_id_fkey"
      columns: ["project_id","asset_id"]
isOneToOne: false
      referencedRelation: "design_assets"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "design_asset_uploads_project_id_production_brief_id_fkey"
      columns: ["project_id","production_brief_id"]
isOneToOne: false
      referencedRelation: "production_briefs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "design_asset_uploads_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"design_asset_usages": {
                  Row: {
                    "asset_id": string,"created_at": string,"created_by": string,"id": string,"project_id": string,"section_id": string,"web_copy_doc_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id": string,"created_at"?: string,"created_by": string,"id"?: string,"project_id": string,"section_id": string,"web_copy_doc_id": string,"workspace_id": string
                  }
                  Update: {
                    "asset_id"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"project_id"?: string,"section_id"?: string,"web_copy_doc_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "design_asset_usages_project_id_asset_id_fkey"
      columns: ["project_id","asset_id"]
isOneToOne: false
      referencedRelation: "design_assets"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "design_asset_usages_project_id_web_copy_doc_id_fkey"
      columns: ["project_id","web_copy_doc_id"]
isOneToOne: false
      referencedRelation: "web_copy_docs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "design_asset_usages_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"design_asset_versions": {
                  Row: {
                    "asset_id": string,"change_note": string | null,"created_at": string,"created_by": string,"file_name": string,"file_size_bytes": number,"id": string,"kind": string,"mime_type": string,"restored_from_version_no": number | null,"sha256": string,"source_brief_revision": number,"storage_key": string,"version_no": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id": string,"change_note"?: string | null,"created_at"?: string,"created_by": string,"file_name": string,"file_size_bytes": number,"id"?: string,"kind": string,"mime_type": string,"restored_from_version_no"?: number | null,"sha256": string,"source_brief_revision": number,"storage_key": string,"version_no": number,"workspace_id": string
                  }
                  Update: {
                    "asset_id"?: string,"change_note"?: string | null,"created_at"?: string,"created_by"?: string,"file_name"?: string,"file_size_bytes"?: number,"id"?: string,"kind"?: string,"mime_type"?: string,"restored_from_version_no"?: number | null,"sha256"?: string,"source_brief_revision"?: number,"storage_key"?: string,"version_no"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "design_asset_versions_workspace_id_asset_id_fkey"
      columns: ["workspace_id","asset_id"]
isOneToOne: false
      referencedRelation: "design_assets"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"design_assets": {
                  Row: {
                    "archived_at": string | null,"asset_kind": string,"created_at": string,"created_by": string,"current_version_no": number,"id": string,"license_note": string | null,"origin_type": string,"production_brief_id": string,"project_id": string,"revision": number,"source_brief_revision": number,"status": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"asset_kind": string,"created_at"?: string,"created_by": string,"current_version_no": number,"id"?: string,"license_note"?: string | null,"origin_type": string,"production_brief_id": string,"project_id": string,"revision"?: number,"source_brief_revision": number,"status"?: string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"asset_kind"?: string,"created_at"?: string,"created_by"?: string,"current_version_no"?: number,"id"?: string,"license_note"?: string | null,"origin_type"?: string,"production_brief_id"?: string,"project_id"?: string,"revision"?: number,"source_brief_revision"?: number,"status"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "design_assets_current_version_fkey"
      columns: ["id","current_version_no"]
isOneToOne: false
      referencedRelation: "design_asset_versions"
      referencedColumns: ["asset_id","version_no"]
    },{
      foreignKeyName: "design_assets_project_id_production_brief_id_fkey"
      columns: ["project_id","production_brief_id"]
isOneToOne: false
      referencedRelation: "production_briefs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "design_assets_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"execution_jobs": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"archived_at": string | null,"attempt_count": number,"block_reason": string | null,"channel": string,"created_at": string,"created_by": string,"executed_at": string | null,"external_url": string | null,"held_from": string | null,"id": string,"idempotency_key": string,"last_error_code": string | null,"payload": NonNullable<Json>,"project_id": string,"publication_id": string | null,"revision": number,"source_hash": string,"source_id": string,"source_kind": string,"source_revision": number,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"archived_at"?: string | null,"attempt_count"?: number,"block_reason"?: string | null,"channel": string,"created_at"?: string,"created_by": string,"executed_at"?: string | null,"external_url"?: string | null,"held_from"?: string | null,"id"?: string,"idempotency_key": string,"last_error_code"?: string | null,"payload": NonNullable<Json>,"project_id": string,"publication_id"?: string | null,"revision"?: number,"source_hash": string,"source_id": string,"source_kind": string,"source_revision": number,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"archived_at"?: string | null,"attempt_count"?: number,"block_reason"?: string | null,"channel"?: string,"created_at"?: string,"created_by"?: string,"executed_at"?: string | null,"external_url"?: string | null,"held_from"?: string | null,"id"?: string,"idempotency_key"?: string,"last_error_code"?: string | null,"payload"?: NonNullable<Json>,"project_id"?: string,"publication_id"?: string | null,"revision"?: number,"source_hash"?: string,"source_id"?: string,"source_kind"?: string,"source_revision"?: number,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "execution_jobs_source_id_publication_id_fkey"
      columns: ["source_id","publication_id"]
isOneToOne: false
      referencedRelation: "channel_publications"
      referencedColumns: ["draft_id","id"]
    },{
      foreignKeyName: "execution_jobs_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"execution_results": {
                  Row: {
                    "archived_at": string | null,"collection_mode": string,"created_at": string,"created_by": string,"denominator": number | null,"execution_job_id": string | null,"id": string,"metric_name": string,"numerator": number | null,"period_end": string,"period_start": string,"project_id": string,"revision": number,"source_note": string,"status": string,"unit": string,"updated_at": string,"value": number,"void_reason": string | null,"voided_at": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"collection_mode": string,"created_at"?: string,"created_by": string,"denominator"?: number | null,"execution_job_id"?: string | null,"id"?: string,"metric_name": string,"numerator"?: number | null,"period_end": string,"period_start": string,"project_id": string,"revision"?: number,"source_note": string,"status"?: string,"unit": string,"updated_at"?: string,"value": number,"void_reason"?: string | null,"voided_at"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"collection_mode"?: string,"created_at"?: string,"created_by"?: string,"denominator"?: number | null,"execution_job_id"?: string | null,"id"?: string,"metric_name"?: string,"numerator"?: number | null,"period_end"?: string,"period_start"?: string,"project_id"?: string,"revision"?: number,"source_note"?: string,"status"?: string,"unit"?: string,"updated_at"?: string,"value"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "execution_results_project_id_execution_job_id_fkey"
      columns: ["project_id","execution_job_id"]
isOneToOne: false
      referencedRelation: "execution_jobs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "execution_results_workspace_id_project_id_fkey"
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
                    "archived_at": string | null,"channel": string | null,"created_at": string,"created_by": string,"description": string | null,"details": Json | null,"funnel_id": string,"id": string,"kind": string,"lead_magnet_id": string | null,"position": number,"revision": number,"stage_id": string,"status": string,"target_note": string | null,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"channel"?: string | null,"created_at"?: string,"created_by": string,"description"?: string | null,"details"?: Json | null,"funnel_id": string,"id"?: string,"kind": string,"lead_magnet_id"?: string | null,"position": number,"revision"?: number,"stage_id": string,"status"?: string,"target_note"?: string | null,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"channel"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"details"?: Json | null,"funnel_id"?: string,"id"?: string,"kind"?: string,"lead_magnet_id"?: string | null,"position"?: number,"revision"?: number,"stage_id"?: string,"status"?: string,"target_note"?: string | null,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "funnel_items_funnel_id_stage_id_fkey"
      columns: ["funnel_id","stage_id"]
isOneToOne: false
      referencedRelation: "funnel_stages"
      referencedColumns: ["funnel_id","id"]
    },{
      foreignKeyName: "funnel_items_lead_magnet_fk"
      columns: ["funnel_id","lead_magnet_id"]
isOneToOne: false
      referencedRelation: "lead_magnets"
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
                },"lead_magnets": {
                  Row: {
                    "archived_at": string | null,"audience": string | null,"created_at": string,"created_by": string,"delivery": string | null,"format": string,"funnel_id": string,"id": string,"lead_fields": NonNullable<Json>,"outline": NonNullable<Json>,"project_id": string,"promise": string | null,"revision": number,"stage_id": string,"status": string,"strategy_artifact_id": string,"strategy_version_id": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"audience"?: string | null,"created_at"?: string,"created_by": string,"delivery"?: string | null,"format": string,"funnel_id": string,"id"?: string,"lead_fields"?: NonNullable<Json>,"outline"?: NonNullable<Json>,"project_id": string,"promise"?: string | null,"revision"?: number,"stage_id": string,"status"?: string,"strategy_artifact_id": string,"strategy_version_id": string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"audience"?: string | null,"created_at"?: string,"created_by"?: string,"delivery"?: string | null,"format"?: string,"funnel_id"?: string,"id"?: string,"lead_fields"?: NonNullable<Json>,"outline"?: NonNullable<Json>,"project_id"?: string,"promise"?: string | null,"revision"?: number,"stage_id"?: string,"status"?: string,"strategy_artifact_id"?: string,"strategy_version_id"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_magnets_funnel_id_stage_id_fkey"
      columns: ["funnel_id","stage_id"]
isOneToOne: false
      referencedRelation: "funnel_stages"
      referencedColumns: ["funnel_id","id"]
    },{
      foreignKeyName: "lead_magnets_strategy_artifact_id_strategy_version_id_fkey"
      columns: ["strategy_artifact_id","strategy_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["artifact_id","id"]
    },{
      foreignKeyName: "lead_magnets_workspace_id_funnel_id_fkey"
      columns: ["workspace_id","funnel_id"]
isOneToOne: false
      referencedRelation: "funnels"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "lead_magnets_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"ppt_deck_versions": {
                  Row: {
                    "created_at": string,"created_by": string,"deck_id": string,"id": string,"kind": string,"restored_from_version_no": number | null,"slide_count": number,"slides": NonNullable<Json>,"source_brief_revision": number,"status": string,"template_key": string,"title": string,"version_no": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"deck_id": string,"id"?: string,"kind": string,"restored_from_version_no"?: number | null,"slide_count": number,"slides": NonNullable<Json>,"source_brief_revision": number,"status": string,"template_key": string,"title": string,"version_no": number,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"deck_id"?: string,"id"?: string,"kind"?: string,"restored_from_version_no"?: number | null,"slide_count"?: number,"slides"?: NonNullable<Json>,"source_brief_revision"?: number,"status"?: string,"template_key"?: string,"title"?: string,"version_no"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ppt_deck_versions_workspace_id_deck_id_fkey"
      columns: ["workspace_id","deck_id"]
isOneToOne: false
      referencedRelation: "ppt_decks"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"ppt_decks": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string,"current_version_no": number,"id": string,"production_brief_id": string,"project_id": string,"revision": number,"source_brief_revision": number,"status": string,"template_key": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by": string,"current_version_no": number,"id"?: string,"production_brief_id": string,"project_id": string,"revision"?: number,"source_brief_revision": number,"status"?: string,"template_key": string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string,"current_version_no"?: number,"id"?: string,"production_brief_id"?: string,"project_id"?: string,"revision"?: number,"source_brief_revision"?: number,"status"?: string,"template_key"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ppt_decks_current_version_fkey"
      columns: ["id","current_version_no"]
isOneToOne: false
      referencedRelation: "ppt_deck_versions"
      referencedColumns: ["deck_id","version_no"]
    },{
      foreignKeyName: "ppt_decks_project_id_production_brief_id_fkey"
      columns: ["project_id","production_brief_id"]
isOneToOne: false
      referencedRelation: "production_briefs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "ppt_decks_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"production_briefs": {
                  Row: {
                    "archived_at": string | null,"brand_tone_constraints": string | null,"core_message": string,"created_at": string,"created_by": string,"deliverable_types": (string)[],"id": string,"project_id": string,"reference_notes": string | null,"revision": number,"scope_summary": string,"source_snapshot": NonNullable<Json>,"status": string,"strategy_artifact_id": string,"strategy_version_id": string,"target_audience": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"brand_tone_constraints"?: string | null,"core_message": string,"created_at"?: string,"created_by": string,"deliverable_types": (string)[],"id"?: string,"project_id": string,"reference_notes"?: string | null,"revision"?: number,"scope_summary": string,"source_snapshot": NonNullable<Json>,"status"?: string,"strategy_artifact_id": string,"strategy_version_id": string,"target_audience": string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"brand_tone_constraints"?: string | null,"core_message"?: string,"created_at"?: string,"created_by"?: string,"deliverable_types"?: (string)[],"id"?: string,"project_id"?: string,"reference_notes"?: string | null,"revision"?: number,"scope_summary"?: string,"source_snapshot"?: NonNullable<Json>,"status"?: string,"strategy_artifact_id"?: string,"strategy_version_id"?: string,"target_audience"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "production_briefs_project_id_strategy_artifact_id_fkey"
      columns: ["project_id","strategy_artifact_id"]
isOneToOne: false
      referencedRelation: "artifacts"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "production_briefs_strategy_artifact_id_strategy_version_id_fkey"
      columns: ["strategy_artifact_id","strategy_version_id"]
isOneToOne: false
      referencedRelation: "artifact_versions"
      referencedColumns: ["artifact_id","id"]
    },{
      foreignKeyName: "production_briefs_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
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
                },"qa_check_items": {
                  Row: {
                    "checked_at": string | null,"checked_by": string | null,"created_at": string,"id": string,"is_default": boolean,"is_required": boolean,"item_title": string,"memo": string | null,"review_id": string,"sort_order": number,"verdict": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "checked_at"?: string | null,"checked_by"?: string | null,"created_at"?: string,"id"?: string,"is_default"?: boolean,"is_required"?: boolean,"item_title": string,"memo"?: string | null,"review_id": string,"sort_order": number,"verdict"?: string,"workspace_id": string
                  }
                  Update: {
                    "checked_at"?: string | null,"checked_by"?: string | null,"created_at"?: string,"id"?: string,"is_default"?: boolean,"is_required"?: boolean,"item_title"?: string,"memo"?: string | null,"review_id"?: string,"sort_order"?: number,"verdict"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "qa_check_items_workspace_id_review_id_fkey"
      columns: ["workspace_id","review_id"]
isOneToOne: false
      referencedRelation: "qa_reviews"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"qa_reviews": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"archived_at": string | null,"created_at": string,"created_by": string,"design_asset_id": string | null,"design_asset_version_id": string | null,"id": string,"ppt_deck_id": string | null,"ppt_deck_version_id": string | null,"project_id": string,"revision": number,"round_no": number,"status": string,"target_id": string | null,"target_kind": string,"target_version_no": number,"updated_at": string,"video_plan_id": string | null,"video_plan_version_id": string | null,"web_copy_doc_id": string | null,"web_copy_version_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"archived_at"?: string | null,"created_at"?: string,"created_by": string,"design_asset_id"?: string | null,"design_asset_version_id"?: string | null,"id"?: string,"ppt_deck_id"?: string | null,"ppt_deck_version_id"?: string | null,"project_id": string,"revision"?: number,"round_no": number,"status"?: string,"target_id"?: never,"target_kind": string,"target_version_no": number,"updated_at"?: string,"video_plan_id"?: string | null,"video_plan_version_id"?: string | null,"web_copy_doc_id"?: string | null,"web_copy_version_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"archived_at"?: string | null,"created_at"?: string,"created_by"?: string,"design_asset_id"?: string | null,"design_asset_version_id"?: string | null,"id"?: string,"ppt_deck_id"?: string | null,"ppt_deck_version_id"?: string | null,"project_id"?: string,"revision"?: number,"round_no"?: number,"status"?: string,"target_id"?: never,"target_kind"?: string,"target_version_no"?: number,"updated_at"?: string,"video_plan_id"?: string | null,"video_plan_version_id"?: string | null,"web_copy_doc_id"?: string | null,"web_copy_version_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "qa_reviews_design_asset_id_design_asset_version_id_fkey"
      columns: ["design_asset_id","design_asset_version_id"]
isOneToOne: false
      referencedRelation: "design_asset_versions"
      referencedColumns: ["asset_id","id"]
    },{
      foreignKeyName: "qa_reviews_ppt_deck_id_ppt_deck_version_id_fkey"
      columns: ["ppt_deck_id","ppt_deck_version_id"]
isOneToOne: false
      referencedRelation: "ppt_deck_versions"
      referencedColumns: ["deck_id","id"]
    },{
      foreignKeyName: "qa_reviews_project_id_design_asset_id_fkey"
      columns: ["project_id","design_asset_id"]
isOneToOne: false
      referencedRelation: "design_assets"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "qa_reviews_project_id_ppt_deck_id_fkey"
      columns: ["project_id","ppt_deck_id"]
isOneToOne: false
      referencedRelation: "ppt_decks"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "qa_reviews_project_id_video_plan_id_fkey"
      columns: ["project_id","video_plan_id"]
isOneToOne: false
      referencedRelation: "video_plans"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "qa_reviews_project_id_web_copy_doc_id_fkey"
      columns: ["project_id","web_copy_doc_id"]
isOneToOne: false
      referencedRelation: "web_copy_docs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "qa_reviews_video_plan_id_video_plan_version_id_fkey"
      columns: ["video_plan_id","video_plan_version_id"]
isOneToOne: false
      referencedRelation: "video_plan_versions"
      referencedColumns: ["plan_id","id"]
    },{
      foreignKeyName: "qa_reviews_web_copy_doc_id_web_copy_version_id_fkey"
      columns: ["web_copy_doc_id","web_copy_version_id"]
isOneToOne: false
      referencedRelation: "web_copy_versions"
      referencedColumns: ["doc_id","id"]
    },{
      foreignKeyName: "qa_reviews_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
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
                },"source_asset_uploads": {
                  Row: {
                    "bytes": number,"client_id": string | null,"created_at": string,"created_by": string,"decided_at": string | null,"expires_at": string,"file_name": string,"id": string,"mime": string,"object_key": string,"project_id": string | null,"reject_reason": string | null,"status": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bytes": number,"client_id"?: string | null,"created_at"?: string,"created_by": string,"decided_at"?: string | null,"expires_at": string,"file_name": string,"id"?: string,"mime": string,"object_key": string,"project_id"?: string | null,"reject_reason"?: string | null,"status"?: string,"workspace_id": string
                  }
                  Update: {
                    "bytes"?: number,"client_id"?: string | null,"created_at"?: string,"created_by"?: string,"decided_at"?: string | null,"expires_at"?: string,"file_name"?: string,"id"?: string,"mime"?: string,"object_key"?: string,"project_id"?: string | null,"reject_reason"?: string | null,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "source_asset_uploads_workspace_id_client_id_fkey"
      columns: ["workspace_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "source_asset_uploads_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "source_asset_uploads_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
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
                },"video_file_uploads": {
                  Row: {
                    "close_reason": string | null,"created_at": string,"created_by": string,"decided_at": string | null,"expires_at": string,"file_name": string,"file_size_bytes": number,"id": string,"mime_type": string,"plan_id": string,"status": string,"storage_key": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "close_reason"?: string | null,"created_at"?: string,"created_by": string,"decided_at"?: string | null,"expires_at": string,"file_name": string,"file_size_bytes": number,"id"?: string,"mime_type": string,"plan_id": string,"status"?: string,"storage_key": string,"workspace_id": string
                  }
                  Update: {
                    "close_reason"?: string | null,"created_at"?: string,"created_by"?: string,"decided_at"?: string | null,"expires_at"?: string,"file_name"?: string,"file_size_bytes"?: number,"id"?: string,"mime_type"?: string,"plan_id"?: string,"status"?: string,"storage_key"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_file_uploads_workspace_id_plan_id_fkey"
      columns: ["workspace_id","plan_id"]
isOneToOne: false
      referencedRelation: "video_plans"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"video_file_versions": {
                  Row: {
                    "change_note": string | null,"created_at": string,"created_by": string,"file_name": string,"file_size_bytes": number,"id": string,"kind": string,"mime_type": string,"plan_id": string,"restored_from_version_no": number | null,"storage_key": string,"version_no": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "change_note"?: string | null,"created_at"?: string,"created_by": string,"file_name": string,"file_size_bytes": number,"id"?: string,"kind": string,"mime_type": string,"plan_id": string,"restored_from_version_no"?: number | null,"storage_key": string,"version_no": number,"workspace_id": string
                  }
                  Update: {
                    "change_note"?: string | null,"created_at"?: string,"created_by"?: string,"file_name"?: string,"file_size_bytes"?: number,"id"?: string,"kind"?: string,"mime_type"?: string,"plan_id"?: string,"restored_from_version_no"?: number | null,"storage_key"?: string,"version_no"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_file_versions_workspace_id_plan_id_fkey"
      columns: ["workspace_id","plan_id"]
isOneToOne: false
      referencedRelation: "video_plans"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"video_plan_versions": {
                  Row: {
                    "aspect_ratio": string,"created_at": string,"created_by": string,"id": string,"kind": string,"plan_id": string,"restored_from_version_no": number | null,"scenes": NonNullable<Json>,"source_brief_revision": number,"status": string,"title": string,"total_duration_sec": number,"version_no": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "aspect_ratio": string,"created_at"?: string,"created_by": string,"id"?: string,"kind": string,"plan_id": string,"restored_from_version_no"?: number | null,"scenes": NonNullable<Json>,"source_brief_revision": number,"status": string,"title": string,"total_duration_sec": number,"version_no": number,"workspace_id": string
                  }
                  Update: {
                    "aspect_ratio"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"kind"?: string,"plan_id"?: string,"restored_from_version_no"?: number | null,"scenes"?: NonNullable<Json>,"source_brief_revision"?: number,"status"?: string,"title"?: string,"total_duration_sec"?: number,"version_no"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_plan_versions_workspace_id_plan_id_fkey"
      columns: ["workspace_id","plan_id"]
isOneToOne: false
      referencedRelation: "video_plans"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"video_plans": {
                  Row: {
                    "archived_at": string | null,"aspect_ratio": string,"created_at": string,"created_by": string,"current_file_version_no": number | null,"current_version_no": number,"id": string,"production_brief_id": string,"project_id": string,"revision": number,"source_brief_revision": number,"status": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"aspect_ratio": string,"created_at"?: string,"created_by": string,"current_file_version_no"?: number | null,"current_version_no": number,"id"?: string,"production_brief_id": string,"project_id": string,"revision"?: number,"source_brief_revision": number,"status"?: string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"aspect_ratio"?: string,"created_at"?: string,"created_by"?: string,"current_file_version_no"?: number | null,"current_version_no"?: number,"id"?: string,"production_brief_id"?: string,"project_id"?: string,"revision"?: number,"source_brief_revision"?: number,"status"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_plans_current_file_fkey"
      columns: ["id","current_file_version_no"]
isOneToOne: false
      referencedRelation: "video_file_versions"
      referencedColumns: ["plan_id","version_no"]
    },{
      foreignKeyName: "video_plans_current_version_fkey"
      columns: ["id","current_version_no"]
isOneToOne: false
      referencedRelation: "video_plan_versions"
      referencedColumns: ["plan_id","version_no"]
    },{
      foreignKeyName: "video_plans_project_id_production_brief_id_fkey"
      columns: ["project_id","production_brief_id"]
isOneToOne: false
      referencedRelation: "production_briefs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "video_plans_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"web_copy_docs": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string,"current_version_no": number,"id": string,"production_brief_id": string,"project_id": string,"revision": number,"source_brief_revision": number,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by": string,"current_version_no": number,"id"?: string,"production_brief_id": string,"project_id": string,"revision"?: number,"source_brief_revision": number,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string,"current_version_no"?: number,"id"?: string,"production_brief_id"?: string,"project_id"?: string,"revision"?: number,"source_brief_revision"?: number,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "web_copy_docs_current_version_fkey"
      columns: ["id","current_version_no"]
isOneToOne: false
      referencedRelation: "web_copy_versions"
      referencedColumns: ["doc_id","version_no"]
    },{
      foreignKeyName: "web_copy_docs_project_id_production_brief_id_fkey"
      columns: ["project_id","production_brief_id"]
isOneToOne: false
      referencedRelation: "production_briefs"
      referencedColumns: ["project_id","id"]
    },{
      foreignKeyName: "web_copy_docs_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"web_copy_versions": {
                  Row: {
                    "content": NonNullable<Json>,"created_at": string,"created_by": string,"doc_id": string,"id": string,"kind": string,"restored_from_version_no": number | null,"source_brief_revision": number,"status": string,"version_no": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": NonNullable<Json>,"created_at"?: string,"created_by": string,"doc_id": string,"id"?: string,"kind": string,"restored_from_version_no"?: number | null,"source_brief_revision": number,"status": string,"version_no": number,"workspace_id": string
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string,"doc_id"?: string,"id"?: string,"kind"?: string,"restored_from_version_no"?: number | null,"source_brief_revision"?: number,"status"?: string,"version_no"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "web_copy_versions_workspace_id_doc_id_fkey"
      columns: ["workspace_id","doc_id"]
isOneToOne: false
      referencedRelation: "web_copy_docs"
      referencedColumns: ["workspace_id","id"]
    }
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
"add_delivery_log":
{ Args: { "p_bundle_id": string,"p_delivered_at": string,"p_expected_revision": number,"p_method": string,"p_note": string }; Returns: number
                           },
"add_execution_result":
{ Args: { "p_collection_mode"?: string,"p_denominator": number,"p_execution_job_id": string,"p_metric_name": string,"p_numerator": number,"p_period_end": string,"p_period_start": string,"p_project_id": string,"p_source_note": string,"p_unit": string,"p_value": number }; Returns: string
                           },
"add_funnel_item":
{ Args: { "p_channel"?: string,"p_description"?: string,"p_details"?: Json,"p_kind": string,"p_stage_id": string,"p_status"?: string,"p_target_note"?: string,"p_title": string }; Returns: string
                           },
"add_qa_item":
{ Args: { "p_expected_revision": number,"p_is_required": boolean,"p_review_id": string,"p_title": string }; Returns: number
                           },
"add_research_source":
{ Args: { "p_project_id": string,"p_publisher"?: string,"p_quoted_excerpt"?: string,"p_retrieved_at": string,"p_title": string,"p_url": string }; Returns: string
                           },
"admin_list_accounts":
{ Args: { "p_before_created"?: string,"p_before_id"?: string,"p_limit"?: number }; Returns: {
              "allowlisted": boolean,"clients": number,"email": string,"email_confirmed": boolean,"last_sign_in_at": string,"projects": number,"signed_up_at": string,"tasks": number,"user_id": string,"workspace_created_at": string,"workspace_id": string,"workspace_name": string
            }[]
                           },
"admin_list_audit":
{ Args: { "p_action"?: string,"p_before_seq"?: number,"p_from"?: string,"p_limit"?: number,"p_to"?: string,"p_workspace_id"?: string }; Returns: {
              "action": string,"actor_id": string,"details": Json,"entity_id": string,"entity_type": string,"occurred_at": string,"revision": number,"seq": number,"workspace_id": string
            }[]
                           },
"admin_list_pending_allowlist":
{ Args: Record<PropertyKey, never>; Returns: {
              "added_at": string,"email": string,"note": string
            }[]
                           },
"admin_p3_progress":
{ Args: { "p_limit"?: number }; Returns: {
              "brief_limit_reached": boolean,"briefs_archived": number,"briefs_drafting": number,"briefs_ready": number,"last_activity_at": string,"owner_email": string,"pending_approvals": number,"project_id": string,"stale_briefs": number,"stale_web_docs": number,"web_docs_archived": number,"web_docs_drafting": number,"web_docs_reviewed": number,"web_version_limit_reached": number,"web_versions": number,"workspace_id": string,"workspace_name": string
            }[]
                           },
"admin_p4_execution":
{ Args: { "p_limit"?: number }; Returns: {
              "blocked_content_changed": number,"blocked_not_reviewed": number,"blocked_source_archived": number,"jobs_blocked_mismatch": number,"jobs_failed": number,"jobs_held": number,"jobs_pending_approval": number,"jobs_queued": number,"jobs_running": number,"jobs_succeeded": number,"last_activity_at": string,"project_id": string,"results_active": number,"retry_exhausted": number,"tistory_published": number,"workspace_id": string
            }[]
                           },
"admin_usage_summary":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "ai_cost_usd_micro": number,"ai_runs": number,"artifact_versions_created": number,"asset_bytes": number,"assets_added": number,"briefs_created": number,"last_activity_at": string,"owner_email": string,"tasks_created": number,"workspace_id": string,"workspace_name": string
            }[]
                           },
"admin_whoami":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"approve_company_profile_version":
{ Args: { "p_comment"?: string,"p_decision": string,"p_expected_last_seq": number,"p_profile_version_id": string }; Returns: number
                           },
"approve_execution":
{ Args: { "p_expected_revision": number,"p_job_id": string }; Returns: Json
                           },
"approve_qa_review":
{ Args: { "p_expected_revision": number,"p_review_id": string }; Returns: number
                           },
"archive_brief_claim":
{ Args: { "p_claim_id": string,"p_expected_revision": number }; Returns: number
                           },
"archive_channel_draft":
{ Args: { "p_draft_id": string,"p_expected_revision": number }; Returns: number
                           },
"archive_content_brief":
{ Args: { "p_brief_id": string,"p_expected_revision": number }; Returns: number
                           },
"archive_delivery_bundle":
{ Args: { "p_bundle_id": string,"p_expected_revision": number }; Returns: number
                           },
"archive_design_asset":
{ Args: { "p_asset_id": string,"p_expected_revision": number }; Returns: number
                           },
"archive_execution":
{ Args: { "p_expected_revision": number,"p_job_id": string }; Returns: number
                           },
"archive_execution_result":
{ Args: { "p_result_id": string }; Returns: number
                           },
"archive_funnel_item":
{ Args: { "p_expected_revision": number,"p_item_id": string }; Returns: number
                           },
"archive_lead_magnet":
{ Args: { "p_expected_revision": number,"p_lead_magnet_id": string }; Returns: number
                           },
"archive_ppt_deck":
{ Args: { "p_deck_id": string,"p_expected_revision": number }; Returns: number
                           },
"archive_production_brief":
{ Args: { "p_brief_id": string,"p_expected_revision": number }; Returns: number
                           },
"archive_qa_review":
{ Args: { "p_expected_revision": number,"p_review_id": string }; Returns: number
                           },
"archive_video_plan":
{ Args: { "p_expected_revision": number,"p_plan_id": string }; Returns: number
                           },
"archive_web_copy":
{ Args: { "p_doc_id": string,"p_expected_revision": number }; Returns: number
                           },
"assign_quote_number":
{ Args: { "p_issue_date"?: string,"p_quote_id": string }; Returns: string
                           },
"close_video_file_upload":
{ Args: { "p_reason": string,"p_signature": string,"p_signed_at": number,"p_upload_id": string }; Returns: undefined
                           },
"confirm_source_upload":
{ Args: { "p_sha256": string,"p_signature": string,"p_signed_at": number,"p_upload_id": string }; Returns: string
                           },
"confirm_video_file_upload":
{ Args: { "p_change_note": string,"p_expected_revision": number,"p_signature": string,"p_signed_at": number,"p_upload_id": string }; Returns: number
                           },
"create_channel_draft":
{ Args: { "p_brief_id": string }; Returns: string
                           },
"create_content_brief":
{ Args: { "p_audience"?: string,"p_channel": string,"p_channel_spec"?: Json,"p_core_message"?: string,"p_cta"?: string,"p_funnel_item_id": string,"p_title": string }; Returns: {
              "brief_id": string,"reused": boolean
            }[]
                           },
"create_delivery_bundle":
{ Args: { "p_project_id": string }; Returns: string
                           },
"create_design_asset":
{ Args: { "p_license_note": string,"p_origin_type": string,"p_sha256": string,"p_signature": string,"p_signed_at": number,"p_title": string,"p_upload_id": string }; Returns: string
                           },
"create_funnel":
{ Args: { "p_strategy_artifact_id": string }; Returns: {
              "funnel_id": string,"reused": boolean
            }[]
                           },
"create_lead_magnet":
{ Args: { "p_audience"?: string,"p_delivery"?: string,"p_format": string,"p_lead_fields"?: Json,"p_outline"?: Json,"p_promise"?: string,"p_stage_id": string,"p_status"?: string,"p_title": string }; Returns: string
                           },
"create_ppt_deck":
{ Args: { "p_production_brief_id": string,"p_slides": Json,"p_template_key": string,"p_title": string }; Returns: string
                           },
"create_production_brief":
{ Args: { "p_brand_tone_constraints"?: string,"p_core_message": string,"p_deliverable_types": (string)[],"p_project_id": string,"p_reference_notes"?: string,"p_scope_summary": string,"p_strategy_artifact_id": string,"p_target_audience": string,"p_title": string }; Returns: string
                           },
"create_video_plan":
{ Args: { "p_aspect_ratio": string,"p_production_brief_id": string,"p_scenes": Json,"p_title": string }; Returns: string
                           },
"create_web_copy_doc":
{ Args: { "p_copy_from_doc_id"?: string,"p_production_brief_id": string }; Returns: string
                           },
"decide_version":
{ Args: { "p_artifact_id": string,"p_comment"?: string,"p_decision": string,"p_version_id": string }; Returns: undefined
                           },
"enqueue_execution":
{ Args: { "p_channel": string,"p_project_id": string,"p_source_id": string,"p_source_kind": string }; Returns: string
                           },
"finalize_quote":
{ Args: { "p_artifact_id": string,"p_customer_snapshot": Json,"p_issue_date": string,"p_items": Json,"p_notes": string,"p_payment_terms": string,"p_subtotal_won": number,"p_supplier_profile_id": string,"p_supplier_snapshot": Json,"p_tax_mode": string,"p_tax_rate_bp": number,"p_tax_won": number,"p_total_won": number,"p_valid_until": string,"p_version_id": string }; Returns: {
              "quote_id": string,"quote_number": string,"quote_version_id": string,"reused": boolean
            }[]
                           },
"finish_brief_copy_run":
{ Args: { "p_cost_usd_micro": number,"p_error_code": string,"p_input_tokens": number,"p_output_tokens": number,"p_problems": string,"p_run_id": string,"p_signature": string,"p_status": string,"p_variants": string }; Returns: undefined
                           },
"generate_strategy":
{ Args: { "p_content": Json,"p_extra_inputs": Json,"p_idempotency_key": string,"p_profile_version_id": string,"p_task_id": string }; Returns: {
              "artifact_id": string,"reused": boolean,"version": number,"version_id": string
            }[]
                           },
"hold_execution":
{ Args: { "p_expected_revision": number,"p_job_id": string }; Returns: Json
                           },
"link_claim_source":
{ Args: { "p_claim_id": string,"p_kind": string,"p_note"?: string,"p_profile_field"?: string,"p_target_id": string }; Returns: string
                           },
"open_qa_review":
{ Args: { "p_target_id": string,"p_target_kind": string }; Returns: string
                           },
"rebase_channel_draft":
{ Args: { "p_draft_id": string,"p_expected_revision": number }; Returns: number
                           },
"rebase_content_brief":
{ Args: { "p_brief_id": string,"p_expected_revision": number }; Returns: number
                           },
"rebase_design_asset":
{ Args: { "p_asset_id": string,"p_expected_revision": number }; Returns: number
                           },
"rebase_execution":
{ Args: { "p_expected_revision": number,"p_job_id": string }; Returns: Json
                           },
"rebase_funnel":
{ Args: { "p_expected_revision": number,"p_funnel_id": string }; Returns: number
                           },
"rebase_lead_magnet":
{ Args: { "p_expected_revision": number,"p_lead_magnet_id": string }; Returns: number
                           },
"rebase_ppt_deck":
{ Args: { "p_deck_id": string,"p_expected_revision": number }; Returns: number
                           },
"rebase_production_brief":
{ Args: { "p_brief_id": string,"p_expected_revision": number }; Returns: number
                           },
"rebase_qa_review":
{ Args: { "p_expected_revision": number,"p_review_id": string }; Returns: string
                           },
"rebase_video_plan":
{ Args: { "p_expected_revision": number,"p_plan_id": string }; Returns: number
                           },
"rebase_web_copy":
{ Args: { "p_doc_id": string,"p_expected_revision": number }; Returns: number
                           },
"record_channel_publication":
{ Args: { "p_draft_id": string,"p_note"?: string,"p_published_at": string,"p_url": string }; Returns: string
                           },
"record_delivery":
{ Args: { "p_artifact_id": string,"p_delivered_at": string,"p_method": string,"p_note"?: string }; Returns: string
                           },
"record_generation":
{ Args: { "p_content": Json,"p_extra_inputs": Json,"p_idempotency_key": string,"p_input_hash": string,"p_mode": string,"p_profile_snapshot": Json,"p_source_refs": Json,"p_task_id": string }; Returns: {
              "artifact_id": string,"reused": boolean,"version": number,"version_id": string
            }[]
                           },
"record_tistory_execution":
{ Args: { "p_expected_revision": number,"p_job_id": string,"p_note"?: string,"p_published_at": string,"p_url": string }; Returns: Json
                           },
"reject_design_asset_upload":
{ Args: { "p_reason": string,"p_signature": string,"p_signed_at": number,"p_upload_id": string }; Returns: undefined
                           },
"reject_source_upload":
{ Args: { "p_reason": string,"p_signature": string,"p_signed_at": number,"p_upload_id": string }; Returns: undefined
                           },
"remove_qa_item":
{ Args: { "p_expected_revision": number,"p_item_id": string,"p_review_id": string }; Returns: number
                           },
"replace_design_asset_file":
{ Args: { "p_asset_id": string,"p_change_note": string,"p_expected_revision": number,"p_sha256": string,"p_signature": string,"p_signed_at": number,"p_upload_id": string }; Returns: number
                           },
"request_qa_fix":
{ Args: { "p_expected_revision": number,"p_review_id": string }; Returns: number
                           },
"reserve_brief_copy_run":
{ Args: { "p_brief_id": string,"p_claim_ids": (string)[],"p_expected_revision": number,"p_input_hash": string,"p_model": string,"p_provider": string,"p_signature": string,"p_signed_at": number }; Returns: {
              "reused": boolean,"run_id": string
            }[]
                           },
"reserve_design_asset_upload":
{ Args: { "p_asset_id": string,"p_file_name": string,"p_kind": string,"p_mime": string,"p_production_brief_id": string,"p_signature": string,"p_signed_at": number,"p_size": number }; Returns: {
              "expires_at": string,"storage_key": string,"upload_id": string
            }[]
                           },
"reserve_source_upload":
{ Args: { "p_client_id": string,"p_file_name": string,"p_mime": string,"p_project_id": string,"p_signature": string,"p_signed_at": number,"p_size": number }; Returns: {
              "expires_at": string,"object_key": string,"upload_id": string
            }[]
                           },
"reserve_video_file_upload":
{ Args: { "p_file_name": string,"p_mime": string,"p_plan_id": string,"p_signature": string,"p_signed_at": number,"p_size": number }; Returns: {
              "expires_at": string,"storage_key": string,"upload_id": string
            }[]
                           },
"restore_delivery_bundle":
{ Args: { "p_bundle_id": string }; Returns: string
                           },
"restore_design_asset_version":
{ Args: { "p_asset_id": string,"p_expected_revision": number,"p_version_no": number }; Returns: number
                           },
"restore_ppt_deck_version":
{ Args: { "p_deck_id": string,"p_expected_revision": number,"p_version_no": number }; Returns: number
                           },
"restore_video_file_version":
{ Args: { "p_expected_revision": number,"p_file_version_no": number,"p_plan_id": string }; Returns: number
                           },
"restore_video_plan_version":
{ Args: { "p_expected_revision": number,"p_plan_id": string,"p_version_no": number }; Returns: number
                           },
"restore_web_copy_version":
{ Args: { "p_doc_id": string,"p_expected_revision": number,"p_version_no": number }; Returns: number
                           },
"resume_execution":
{ Args: { "p_expected_revision": number,"p_job_id": string }; Returns: Json
                           },
"retry_execution":
{ Args: { "p_expected_revision": number,"p_job_id": string }; Returns: Json
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
"save_ppt_deck":
{ Args: { "p_deck_id": string,"p_expected_revision": number,"p_slides": Json,"p_status": string,"p_template_key": string,"p_title": string }; Returns: number
                           },
"save_strategy_manual_version":
{ Args: { "p_artifact_id": string,"p_content": Json,"p_expected_revision": number }; Returns: {
              "version": number,"version_id": string
            }[]
                           },
"save_video_plan":
{ Args: { "p_aspect_ratio": string,"p_expected_revision": number,"p_plan_id": string,"p_scenes": Json,"p_status": string,"p_title": string }; Returns: number
                           },
"save_web_copy":
{ Args: { "p_doc_id": string,"p_expected_revision": number,"p_pages": Json,"p_status": string }; Returns: number
                           },
"set_design_asset_usages":
{ Args: { "p_asset_id": string,"p_expected_revision": number,"p_usages": Json }; Returns: number
                           },
"set_funnel_item_lead_magnet":
{ Args: { "p_expected_revision": number,"p_item_id": string,"p_lead_magnet_id": string | null }; Returns: number
                           },
"set_qa_item":
{ Args: { "p_expected_revision": number,"p_item_id": string,"p_memo": string,"p_review_id": string,"p_verdict": string }; Returns: number
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
"update_channel_draft":
{ Args: { "p_body": string,"p_draft_id": string,"p_expected_revision": number,"p_image_note": string,"p_meta_description": string,"p_status": string,"p_tags": Json,"p_title": string }; Returns: number
                           },
"update_content_brief":
{ Args: { "p_audience": string,"p_brief_id": string,"p_channel_spec": Json,"p_copy_draft": string,"p_copy_origin": string,"p_core_message": string,"p_cta": string,"p_expected_revision": number,"p_hook": string,"p_image_guide": string,"p_status": string,"p_title": string }; Returns: number
                           },
"update_delivery_bundle":
{ Args: { "p_bundle_id": string,"p_expected_revision": number,"p_status": string }; Returns: number
                           },
"update_design_asset":
{ Args: { "p_asset_id": string,"p_expected_revision": number,"p_license_note": string,"p_status": string,"p_title": string }; Returns: number
                           },
"update_funnel_item":
{ Args: { "p_channel": string,"p_description": string,"p_details": Json,"p_expected_revision": number,"p_item_id": string,"p_kind": string,"p_stage_id": string,"p_status": string,"p_target_note": string,"p_title": string }; Returns: number
                           },
"update_funnel_stage":
{ Args: { "p_expected_revision": number,"p_focus": string,"p_stage_id": string }; Returns: number
                           },
"update_lead_magnet":
{ Args: { "p_audience": string,"p_delivery": string,"p_expected_revision": number,"p_format": string,"p_lead_fields": Json,"p_lead_magnet_id": string,"p_outline": Json,"p_promise": string,"p_stage_id": string,"p_status": string,"p_title": string }; Returns: number
                           },
"update_production_brief":
{ Args: { "p_brand_tone_constraints": string,"p_brief_id": string,"p_core_message": string,"p_deliverable_types": (string)[],"p_expected_revision": number,"p_reference_notes": string,"p_scope_summary": string,"p_status": string,"p_target_audience": string,"p_title": string }; Returns: number
                           },
"void_channel_publication":
{ Args: { "p_publication_id": string,"p_reason": string }; Returns: string
                           },
"void_execution_result":
{ Args: { "p_reason": string,"p_result_id": string }; Returns: number
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

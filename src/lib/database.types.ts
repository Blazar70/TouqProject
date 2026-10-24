export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          clinic_id: string | null
          created_at: string
          id: string
          target_label: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name: string
          clinic_id?: string | null
          created_at?: string
          id?: string
          target_label?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          clinic_id?: string | null
          created_at?: string
          id?: string
          target_label?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reminders_sent: {
        Row: {
          appointment_id: string
          profile_id: string
          sent_at: string
        }
        Insert: {
          appointment_id: string
          profile_id: string
          sent_at?: string
        }
        Update: {
          appointment_id?: string
          profile_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminders_sent_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reminders_sent_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_services: {
        Row: {
          added_by: string | null
          appointment_id: string
          clinic_id: string
          created_at: string
          description: string
          id: string
          quantity: number
          service_id: string | null
          unit_price: number
          vat_rate: number
        }
        // clinic_id, description, unit_price, vat_rate, added_by: set by the DB trigger (0059).
        Insert: {
          appointment_id: string
          id?: string
          quantity?: number
          service_id: string
        }
        Update: {
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          billed?: boolean | null // computed field (0074), not a column: select('*, billed')
          branch_id: string
          cancellation_category: string | null
          cancellation_reason: string | null
          clinic_id: string
          created_at: string
          created_by: string
          doctor_id: string | null
          id: string
          pet_id: string
          reason: string | null
          scheduled_at: string
          started_at: string | null
          status: string
        }
        Insert: {
          branch_id: string
          cancellation_category?: string | null
          cancellation_reason?: string | null
          clinic_id: string
          created_at?: string
          created_by: string
          doctor_id?: string | null
          id?: string
          pet_id: string
          reason?: string | null
          scheduled_at: string
          started_at?: string | null
          status?: string
        }
        Update: {
          branch_id?: string
          cancellation_category?: string | null
          cancellation_reason?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string
          doctor_id?: string | null
          id?: string
          pet_id?: string
          reason?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_branch_id_clinic_id_fkey"
            columns: ["branch_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_doctor_fkey"
            columns: ["doctor_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          active: boolean
          address: string | null
          clinic_id: string
          created_at: string
          id: string
          invoice_code: string
          is_main: boolean
          name: string
          name_ar: string | null
          phone: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          clinic_id: string
          created_at?: string
          id?: string
          invoice_code?: string
          is_main?: boolean
          name: string
          name_ar?: string | null
          phone?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          clinic_id?: string
          created_at?: string
          id?: string
          invoice_code?: string
          is_main?: boolean
          name?: string
          name_ar?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          billing_status: string
          created_at: string
          deleted_at: string | null
          disabled: boolean
          id: string
          logo_url: string | null
          max_staff_discount_percent: number
          name: string
          phone: string | null
          timezone: string
          vat_number: string | null
        }
        Insert: {
          billing_status?: string
          created_at?: string
          deleted_at?: string | null
          disabled?: boolean
          id?: string
          logo_url?: string | null
          max_staff_discount_percent?: number
          name: string
          phone?: string | null
          timezone?: string
          vat_number?: string | null
        }
        Update: {
          billing_status?: string
          created_at?: string
          deleted_at?: string | null
          disabled?: boolean
          id?: string
          logo_url?: string | null
          max_staff_discount_percent?: number
          name?: string
          phone?: string | null
          timezone?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      doctor_time_off: {
        Row: {
          clinic_id: string
          created_at: string
          created_by: string | null
          doctor_id: string
          ends_at: string
          id: string
          reason: string
          starts_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          created_by?: string | null
          doctor_id: string
          ends_at: string
          id?: string
          reason: string
          starts_at: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          doctor_id?: string
          ends_at?: string
          id?: string
          reason?: string
          starts_at?: string
        }
        Relationships: []
      }
      credit_notes: {
        Row: {
          amount: number
          branch_id: string
          clinic_id: string
          created_at: string
          created_by: string | null
          credit_number: string
          id: string
          invoice_id: string
          item_ids: string[]
          reason: string
          refund_amount: number
          refund_method: string
          vat_amount: number
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          bill_discount_share: number
          description: string
          discount_amount: number
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          id: string
          invoice_id: string
          line_total: number
          position: number
          quantity: number
          service_id: string | null
          unit_price: number
          vat_amount: number
          vat_rate: number
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          branch_id: string
          clinic_id: string
          created_at: string
          id: string
          invoice_id: string
          method: string
          paid_at: string
          received_by: string | null
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_credited: number
          amount_paid: number
          amount_refunded: number
          amount_total: number
          appointment_id: string | null
          branch_id: string
          clinic_id: string
          created_at: string
          created_by: string
          discount_amount: number
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          id: string
          invoice_number: string
          notes: string | null
          payment_status: string
          pet_id: string | null
          pet_name: string | null
          pet_number: number | null
          zatca_icv: number | null
          zatca_previous_hash: string | null
          zatca_uuid: string | null
          vat_total: number
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "invoices_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_branch_id_clinic_id_fkey"
            columns: ["branch_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "invoices_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_records: {
        Row: {
          appointment_id: string | null
          branch_id: string | null
          clinic_id: string
          created_at: string
          diagnosis: string | null
          diagnostic_plan: string | null
          heart_rate_bpm: number | null
          id: string
          notes: string | null
          pet_id: string
          photo_url: string | null
          physical_exam: string | null
          presenting_complaint: string | null
          remarks: string | null
          temperature_c: number | null
          treatment: string | null
          vet_id: string
          visit_date: string
          visit_type: string | null
          weight_kg: number | null
        }
        Insert: {
          appointment_id?: string | null
          branch_id?: string | null
          clinic_id: string
          created_at?: string
          diagnosis?: string | null
          diagnostic_plan?: string | null
          heart_rate_bpm?: number | null
          id?: string
          notes?: string | null
          pet_id: string
          photo_url?: string | null
          physical_exam?: string | null
          presenting_complaint?: string | null
          remarks?: string | null
          temperature_c?: number | null
          treatment?: string | null
          vet_id: string
          visit_date?: string
          visit_type?: string | null
          weight_kg?: number | null
        }
        Update: {
          appointment_id?: string | null
          branch_id?: string | null
          clinic_id?: string
          created_at?: string
          diagnosis?: string | null
          diagnostic_plan?: string | null
          heart_rate_bpm?: number | null
          id?: string
          notes?: string | null
          pet_id?: string
          photo_url?: string | null
          physical_exam?: string | null
          presenting_complaint?: string | null
          remarks?: string | null
          temperature_c?: number | null
          treatment?: string | null
          vet_id?: string
          visit_date?: string
          visit_type?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_branch_id_clinic_id_fkey"
            columns: ["branch_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "medical_records_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_vet_id_fkey"
            columns: ["vet_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_balance_entries: {
        Row: {
          amount: number
          branch_id: string | null
          clinic_id: string
          created_at: string
          created_by: string | null
          credit_note_id: string | null
          id: string
          invoice_id: string | null
          invoice_payment_id: string | null
          kind: string
          method: string | null
          owner_file_id: string
          reason: string | null
          receipt_number: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      owner_files: {
        Row: {
          balance: number
          clinic_id: string
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          clinic_id: string
          email?: string | null
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          email?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      ownership_transfers: {
        Row: {
          from_owner_id: string
          id: string
          pet_id: string
          requested_at: string
          resolved_at: string | null
          status: string
          to_owner_id: string
        }
        Insert: {
          from_owner_id: string
          id?: string
          pet_id: string
          requested_at?: string
          resolved_at?: string | null
          status?: string
          to_owner_id: string
        }
        Update: {
          from_owner_id?: string
          id?: string
          pet_id?: string
          requested_at?: string
          resolved_at?: string | null
          status?: string
          to_owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ownership_transfers_from_owner_id_fkey"
            columns: ["from_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_transfers_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_transfers_to_owner_id_fkey"
            columns: ["to_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          clinic_id: string
          created_at: string
          document_path: string | null
          due_date: string | null
          id: string
          paid_at: string | null
          status: string
        }
        Insert: {
          amount: number
          clinic_id: string
          created_at?: string
          document_path?: string | null
          due_date?: string | null
          id?: string
          paid_at?: string | null
          status?: string
        }
        Update: {
          amount?: number
          clinic_id?: string
          created_at?: string
          document_path?: string | null
          due_date?: string | null
          id?: string
          paid_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_number_counters: {
        Row: {
          clinic_id: string
          last_number: number
        }
        Insert: {
          clinic_id: string
          last_number: number
        }
        Update: {
          clinic_id?: string
          last_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "pet_number_counters_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_trusted_contacts: {
        Row: {
          created_at: string
          id: string
          name: string
          pet_id: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          pet_id: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          pet_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pet_trusted_contacts_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pets: {
        Row: {
          breed: string | null
          clinic_id: string
          created_at: string
          date_of_birth: string | null
          deleted_at: string | null
          home_branch_id: string | null
          id: string
          name: string
          next_vaccination_date: string | null
          owner_email: string | null
          owner_id: string | null
          owner_file_id: string
          owner_name: string
          owner_phone: string | null
          pet_number: number
          photo_url: string | null
          species: string
        }
        Insert: {
          breed?: string | null
          clinic_id: string
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          home_branch_id?: string | null
          id?: string
          name: string
          next_vaccination_date?: string | null
          owner_email?: string | null
          owner_id?: string | null
          owner_file_id?: string
          owner_name: string
          owner_phone?: string | null
          pet_number?: number
          photo_url?: string | null
          species: string
        }
        Update: {
          breed?: string | null
          clinic_id?: string
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          home_branch_id?: string | null
          id?: string
          name?: string
          next_vaccination_date?: string | null
          owner_email?: string | null
          owner_id?: string | null
          owner_file_id?: string
          owner_name?: string
          owner_phone?: string | null
          pet_number?: number
          photo_url?: string | null
          species?: string
        }
        Relationships: [
          {
            foreignKeyName: "pets_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pets_home_branch_id_clinic_id_fkey"
            columns: ["home_branch_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "pets_owner_file_fkey"
            columns: ["owner_file_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "owner_files"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "pets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          calendar_order: number | null
          clinic_id: string | null
          clinic_role: string | null
          created_at: string
          disabled: boolean
          email: string | null
          full_name: string
          id: string
          last_branch_id: string | null
          phone: string | null
          push_notify_statuses: string[]
          push_reminder_lead_minutes: number | null
          role: Database["public"]["Enums"]["user_role"]
          takes_appointments: boolean
          title: string | null
          username: string | null
        }
        Insert: {
          calendar_order?: number | null
          clinic_id?: string | null
          clinic_role?: string | null
          created_at?: string
          disabled?: boolean
          email?: string | null
          full_name: string
          id: string
          last_branch_id?: string | null
          phone?: string | null
          push_notify_statuses?: string[]
          push_reminder_lead_minutes?: number | null
          role: Database["public"]["Enums"]["user_role"]
          takes_appointments?: boolean
          title?: string | null
          username?: string | null
        }
        Update: {
          calendar_order?: number | null
          clinic_id?: string | null
          clinic_role?: string | null
          created_at?: string
          disabled?: boolean
          email?: string | null
          full_name?: string
          id?: string
          last_branch_id?: string | null
          phone?: string | null
          push_notify_statuses?: string[]
          push_reminder_lead_minutes?: number | null
          role?: Database["public"]["Enums"]["user_role"]
          takes_appointments?: boolean
          title?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_last_branch_id_fkey"
            columns: ["last_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          profile_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          profile_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          id: string
          name: string
          price: number
          vat_rate: number
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          name: string
          price: number
          vat_rate?: number
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string
          price?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "services_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_branches: {
        Row: {
          branch_id: string
          profile_id: string
        }
        Insert: {
          branch_id: string
          profile_id: string
        }
        Update: {
          branch_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_branches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccines: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          interval_days: number
          name: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          interval_days: number
          name: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          interval_days?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccines_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_vaccines: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          interval_days: number
          next_due_date: string
          pet_id: string
          vaccine_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          interval_days: number
          next_due_date: string
          pet_id: string
          vaccine_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          interval_days?: number
          next_due_date?: string
          pet_id?: string
          vaccine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_vaccines_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_vaccines_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_vaccines_vaccine_id_clinic_id_fkey"
            columns: ["vaccine_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "vaccines"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      vaccine_doses: {
        Row: {
          clinic_id: string
          created_at: string
          given_by: string | null
          given_on: string
          id: string
          pet_vaccine_id: string
          previous_due_date: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          given_by?: string | null
          given_on: string
          id?: string
          pet_vaccine_id: string
          previous_due_date: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          given_by?: string | null
          given_on?: string
          id?: string
          pet_vaccine_id?: string
          previous_due_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccine_doses_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccine_doses_given_by_fkey"
            columns: ["given_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccine_doses_pet_vaccine_id_fkey"
            columns: ["pet_vaccine_id"]
            isOneToOne: false
            referencedRelation: "pet_vaccines"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_counts: {
        Row: {
          branch_id: string
          clinic_id: string
          counted: number
          counted_at: string
          counted_by: string | null
          day: string
          id: string
        }
        Insert: {
          branch_id: string
          clinic_id: string
          counted: number
          counted_at?: string
          counted_by?: string | null
          day: string
          id?: string
        }
        Update: {
          branch_id?: string
          clinic_id?: string
          counted?: number
          counted_at?: string
          counted_by?: string | null
          day?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_counts_branch_id_clinic_id_fkey"
            columns: ["branch_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "cash_counts_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_counts_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      // Computed field on appointments (0074): select('*, billed').
      billed: { Args: { "": Database["public"]["Tables"]["appointments"]["Row"] }; Returns: boolean }
      mark_vaccine_given: {
        Args: { p_given_on?: string; p_pet_vaccine: string }
        Returns: string
      }
      undo_vaccine_dose: { Args: { p_dose: string }; Returns: undefined }
      admin_clinic_counts: {
        Args: never
        Returns: {
          appointments: number
          clinic_id: string
          pets: number
          staff: number
        }[]
      }
      admin_close_branch: { Args: { p_branch: string }; Returns: number }
      admin_set_main_branch: { Args: { p_branch: string }; Returns: undefined }
      can_manage_clinic_logo: { Args: { p_clinic: string }; Returns: boolean }
      current_user_branch_ids: { Args: never; Returns: string[] }
      current_user_clinic_id: { Args: never; Returns: string }
      current_user_clinic_role: { Args: never; Returns: string }
      current_user_has_role: { Args: { roles: string[] }; Returns: boolean }
      current_user_id_if_active: { Args: never; Returns: string }
      current_user_is_admin: { Args: never; Returns: boolean }
      current_user_is_clinic_manager: { Args: never; Returns: boolean }
      create_invoice: {
        Args: {
          p_pet: string
          p_branch: string | null
          p_appointment: string | null
          p_notes: string | null
          p_lines: Json
          p_discount: Json | null
          p_payments: Json
          p_paid_at?: string
        }
        Returns: string
      }
      add_invoice_payment: {
        Args: { p_invoice: string; p_method: string; p_amount: number; p_branch?: string | null; p_paid_at?: string | null }
        Returns: undefined
      }
      create_credit_note: {
        Args: { p_invoice: string; p_item_ids: string[] | null; p_amount: number | null; p_reason: string; p_refund_method: string }
        Returns: string
      }
      add_owner_balance: {
        Args: { p_owner: string; p_amount: number; p_method: string | null; p_reason?: string | null; p_branch?: string | null }
        Returns: string
      }
      merge_owner_files: {
        Args: { p_keep: string; p_remove: string }
        Returns: undefined
      }
      report_cash_up: {
        Args: { p_day: string; p_branch?: string | null }
        Returns: { branch_id: string; method: string; payments: number; deposits: number; refunds: number; net: number; entries: number }[]
      }
      report_unpaid: {
        Args: { p_branch?: string | null; p_from?: string | null; p_to?: string | null }
        Returns: {
          kind: 'visit' | 'invoice'
          id: string
          at: string
          branch_id: string
          invoice_number: string | null
          pet_name: string
          pet_number: number
          owner_name: string | null
          owner_phone: string | null
          doctor_name: string | null
          total: number
          paid: number
          remaining: number
        }[]
      }
      report_income_services: {
        Args: { p_from: string; p_to: string; p_branch?: string | null }
        Returns: { service_id: string | null; service_name: string | null; quantity: number; net: number; vat: number; total: number; credited: number }[]
      }
      report_income_branches: {
        Args: { p_from: string; p_to: string; p_branch?: string | null }
        Returns: { branch_id: string; invoiced: number; credited: number; net: number; collected: number }[]
      }
      report_vat_summary: {
        Args: { p_from: string; p_to: string; p_branch?: string | null }
        Returns: {
          vat_rate: number
          sales_net: number
          sales_vat: number
          discounts: number
          credit_net: number
          credit_vat: number
          net_taxable: number
          net_vat: number
        }[]
      }
      can_manage_doctor_time_off: { Args: { p_doctor: string }; Returns: boolean }
      doctor_time_off_periods: {
        Args: { p_from: string; p_to: string }
        Returns: { id: string; doctor_id: string; starts_at: string; ends_at: string }[]
      }
      save_doctor_time_off: {
        Args: { p_id: string | null; p_doctor: string | null; p_starts: string; p_ends: string; p_reason: string }
        Returns: number
      }
    }
    Enums: {
      user_role: "vet" | "owner" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      user_role: ["vet", "owner", "admin"],
    },
  },
} as const

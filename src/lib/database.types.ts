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
      appointments: {
        Row: {
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
          name: string
          phone: string | null
          timezone: string
        }
        Insert: {
          billing_status?: string
          created_at?: string
          deleted_at?: string | null
          disabled?: boolean
          id?: string
          logo_url?: string | null
          name: string
          phone?: string | null
          timezone?: string
        }
        Update: {
          billing_status?: string
          created_at?: string
          deleted_at?: string | null
          disabled?: boolean
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          timezone?: string
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          description: string
          id: string
          invoice_id: string
          line_total: number
          quantity: number
          service_id: string | null
          unit_price: number
        }
        Insert: {
          description: string
          id?: string
          invoice_id: string
          line_total: number
          quantity?: number
          service_id?: string | null
          unit_price: number
        }
        Update: {
          description?: string
          id?: string
          invoice_id?: string
          line_total?: number
          quantity?: number
          service_id?: string | null
          unit_price?: number
        }
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
      invoices: {
        Row: {
          amount_total: number
          appointment_id: string | null
          branch_id: string
          clinic_id: string
          created_at: string
          created_by: string
          id: string
          method: string
          notes: string | null
          paid_at: string
          pet_id: string
          status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount_total: number
          appointment_id?: string | null
          branch_id: string
          clinic_id: string
          created_at?: string
          created_by: string
          id?: string
          method: string
          notes?: string | null
          paid_at?: string
          pet_id: string
          status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount_total?: number
          appointment_id?: string | null
          branch_id?: string
          clinic_id?: string
          created_at?: string
          created_by?: string
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          pet_id?: string
          status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
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
          {
            foreignKeyName: "invoices_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          owner_name: string
          owner_phone: string | null
          pet_number: number
          photo_url: string | null
          species: string
          vaccination_interval_days: number | null
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
          owner_name: string
          owner_phone?: string | null
          pet_number?: number
          photo_url?: string | null
          species: string
          vaccination_interval_days?: number | null
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
          owner_name?: string
          owner_phone?: string | null
          pet_number?: number
          photo_url?: string | null
          species?: string
          vaccination_interval_days?: number | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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

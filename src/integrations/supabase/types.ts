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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          module: string
          new_data: Json | null
          old_data: Json | null
          organization_id: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          module: string
          new_data?: Json | null
          old_data?: Json | null
          organization_id: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          module?: string
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          parent_id: string | null
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          parent_id?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          parent_id?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_events: {
        Row: {
          attempts: number
          error_message: string | null
          event_type: string
          external_event_id: string | null
          id: string
          last_attempt_at: string | null
          locked_at: string | null
          locked_by: string | null
          next_retry_at: string | null
          organization_id: string
          payload: Json | null
          processed_at: string | null
          received_at: string
          source: Database["public"]["Enums"]["integration_source"]
          status: Database["public"]["Enums"]["integration_event_status"]
        }
        Insert: {
          attempts?: number
          error_message?: string | null
          event_type: string
          external_event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_retry_at?: string | null
          organization_id: string
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          source: Database["public"]["Enums"]["integration_source"]
          status?: Database["public"]["Enums"]["integration_event_status"]
        }
        Update: {
          attempts?: number
          error_message?: string | null
          event_type?: string
          external_event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_retry_at?: string | null
          organization_id?: string
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          source?: Database["public"]["Enums"]["integration_source"]
          status?: Database["public"]["Enums"]["integration_event_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_mappings: {
        Row: {
          created_at: string
          entity_type: string
          external_id: string
          external_parent_id: string | null
          id: string
          internal_id: string
          metadata: Json | null
          organization_id: string
          source: Database["public"]["Enums"]["integration_source"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          external_id: string
          external_parent_id?: string | null
          id?: string
          internal_id: string
          metadata?: Json | null
          organization_id: string
          source: Database["public"]["Enums"]["integration_source"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          external_id?: string
          external_parent_id?: string | null
          id?: string
          internal_id?: string
          metadata?: Json | null
          organization_id?: string
          source?: Database["public"]["Enums"]["integration_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_balances: {
        Row: {
          available_quantity: number | null
          id: string
          location_id: string
          minimum_quantity: number
          organization_id: string
          physical_quantity: number
          reserved_quantity: number
          updated_at: string
          variant_id: string
        }
        Insert: {
          available_quantity?: number | null
          id?: string
          location_id: string
          minimum_quantity?: number
          organization_id: string
          physical_quantity?: number
          reserved_quantity?: number
          updated_at?: string
          variant_id: string
        }
        Update: {
          available_quantity?: number | null
          id?: string
          location_id?: string
          minimum_quantity?: number
          organization_id?: string
          physical_quantity?: number
          reserved_quantity?: number
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          id: string
          location_id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          notes: string | null
          organization_id: string
          quantity: number
          quantity_after: number
          quantity_before: number
          reason: string | null
          reference_id: string | null
          reference_type: string | null
          source: string | null
          user_id: string | null
          variant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          notes?: string | null
          organization_id: string
          quantity: number
          quantity_after: number
          quantity_before: number
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          source?: string | null
          user_id?: string | null
          variant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          movement_type?: Database["public"]["Enums"]["movement_type"]
          notes?: string | null
          organization_id?: string
          quantity?: number
          quantity_after?: number
          quantity_before?: number
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          source?: string | null
          user_id?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          currency: string
          document: string | null
          email: string | null
          id: string
          logo_url: string | null
          name: string
          phone: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          document?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name: string
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          document?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          code: string
          description: string | null
          id: string
          module: string
          name: string
        }
        Insert: {
          code: string
          description?: string | null
          id?: string
          module: string
          name: string
        }
        Update: {
          code?: string
          description?: string | null
          id?: string
          module?: string
          name?: string
        }
        Relationships: []
      }
      product_images: {
        Row: {
          created_at: string
          id: string
          image_url: string
          is_primary: boolean
          organization_id: string
          position: number
          product_id: string
          storage_path: string | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          image_url: string
          is_primary?: boolean
          organization_id: string
          position?: number
          product_id: string
          storage_path?: string | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          is_primary?: boolean
          organization_id?: string
          position?: number
          product_id?: string
          storage_path?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          color: string | null
          cost_price: number | null
          created_at: string
          deleted_at: string | null
          id: string
          olist_variant_id: string | null
          organization_id: string
          product_id: string
          sale_price: number | null
          shopify_variant_id: string | null
          size: string
          sku: string | null
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          olist_variant_id?: string | null
          organization_id: string
          product_id: string
          sale_price?: number | null
          shopify_variant_id?: string | null
          size: string
          sku?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          olist_variant_id?: string | null
          organization_id?: string
          product_id?: string
          sale_price?: number | null
          shopify_variant_id?: string | null
          size?: string
          sku?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string | null
          category_id: string | null
          collection: string | null
          cost_price: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          height: number | null
          id: string
          length: number | null
          material: string | null
          name: string
          olist_product_id: string | null
          organization_id: string
          promotional_price: number | null
          sale_price: number | null
          shopify_product_id: string | null
          short_description: string | null
          status: Database["public"]["Enums"]["product_status"]
          supplier_id: string | null
          updated_at: string
          weight: number | null
          width: number | null
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          collection?: string | null
          cost_price?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          height?: number | null
          id?: string
          length?: number | null
          material?: string | null
          name: string
          olist_product_id?: string | null
          organization_id: string
          promotional_price?: number | null
          sale_price?: number | null
          shopify_product_id?: string | null
          short_description?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supplier_id?: string | null
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          collection?: string | null
          cost_price?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          height?: number | null
          id?: string
          length?: number | null
          material?: string | null
          name?: string
          olist_product_id?: string | null
          organization_id?: string
          promotional_price?: number | null
          sale_price?: number | null
          shopify_product_id?: string | null
          short_description?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supplier_id?: string | null
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          organization_id: string | null
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          organization_id?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          permission_id: string
          role_id: string
        }
        Insert: {
          allowed?: boolean
          permission_id: string
          role_id: string
        }
        Update: {
          allowed?: boolean
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system_role: boolean
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system_role?: boolean
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system_role?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_locations: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["entity_status"]
          type: Database["public"]["Enums"]["stock_location_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          status?: Database["public"]["Enums"]["entity_status"]
          type?: Database["public"]["Enums"]["stock_location_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["entity_status"]
          type?: Database["public"]["Enums"]["stock_location_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          location_id: string
          organization_id: string
          quantity: number
          reason: string | null
          reference_id: string | null
          reference_type: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          updated_at: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          location_id: string
          organization_id: string
          quantity: number
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
          variant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          location_id?: string
          organization_id?: string
          quantity?: number
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          city: string | null
          created_at: string
          document: string | null
          email: string | null
          id: string
          instagram: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          state: string | null
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          instagram?: string | null
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          instagram?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_stock_movement: {
        Args: {
          _location_id: string
          _movement_type: Database["public"]["Enums"]["movement_type"]
          _notes?: string
          _quantity: number
          _reason?: string
          _reference_id?: string
          _reference_type?: string
          _source?: string
          _variant_id: string
        }
        Returns: string
      }
      create_organization: {
        Args: { _document?: string; _name: string }
        Returns: string
      }
      current_org_id: { Args: never; Returns: string }
      has_permission: { Args: { _code: string }; Returns: boolean }
      has_role: { Args: { _role_name: string }; Returns: boolean }
      is_active: { Args: never; Returns: boolean }
    }
    Enums: {
      entity_status: "ativo" | "inativo"
      integration_event_status:
        | "pendente"
        | "processando"
        | "processado"
        | "erro"
        | "ignorado"
      integration_source: "olist" | "shopify" | "manual"
      movement_type:
        | "entrada"
        | "venda"
        | "troca_entrada"
        | "troca_saida"
        | "devolucao"
        | "cancelamento"
        | "estorno"
        | "ajuste_positivo"
        | "ajuste_negativo"
        | "perda"
        | "avaria"
        | "transferencia"
        | "inventario"
        | "retorno_fornecedor"
        | "reserva"
        | "liberacao_reserva"
      product_status: "ativo" | "inativo" | "rascunho"
      reservation_status: "ativa" | "consumida" | "cancelada" | "expirada"
      stock_location_type: "loja" | "deposito" | "online" | "outros"
      user_status: "ativo" | "inativo" | "pendente"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      entity_status: ["ativo", "inativo"],
      integration_event_status: [
        "pendente",
        "processando",
        "processado",
        "erro",
        "ignorado",
      ],
      integration_source: ["olist", "shopify", "manual"],
      movement_type: [
        "entrada",
        "venda",
        "troca_entrada",
        "troca_saida",
        "devolucao",
        "cancelamento",
        "estorno",
        "ajuste_positivo",
        "ajuste_negativo",
        "perda",
        "avaria",
        "transferencia",
        "inventario",
        "retorno_fornecedor",
        "reserva",
        "liberacao_reserva",
      ],
      product_status: ["ativo", "inativo", "rascunho"],
      reservation_status: ["ativa", "consumida", "cancelada", "expirada"],
      stock_location_type: ["loja", "deposito", "online", "outros"],
      user_status: ["ativo", "inativo", "pendente"],
    },
  },
} as const

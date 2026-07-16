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
      cash_movements: {
        Row: {
          amount: number
          cash_session_id: string
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          payment_method: string | null
          reason: string | null
          sale_id: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          amount: number
          cash_session_id: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          payment_method?: string | null
          reason?: string | null
          sale_id?: string | null
          type: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          cash_session_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          payment_method?: string | null
          reason?: string | null
          sale_id?: string | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_notes: string | null
          counted_amount: number | null
          created_at: string
          difference_amount: number | null
          expected_amount: number | null
          id: string
          location_id: string
          opened_at: string
          opened_by: string
          opening_amount: number
          opening_notes: string | null
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_notes?: string | null
          counted_amount?: number | null
          created_at?: string
          difference_amount?: number | null
          expected_amount?: number | null
          id?: string
          location_id: string
          opened_at?: string
          opened_by: string
          opening_amount?: number
          opening_notes?: string | null
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_notes?: string | null
          counted_amount?: number | null
          created_at?: string
          difference_amount?: number | null
          expected_amount?: number | null
          id?: string
          location_id?: string
          opened_at?: string
          opened_by?: string
          opening_amount?: number
          opening_notes?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_organization_id_fkey"
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
      clients: {
        Row: {
          address: string | null
          address_complement: string | null
          address_number: string | null
          birth_date: string | null
          city: string | null
          cpf: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          full_name: string
          id: string
          instagram: string | null
          neighborhood: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          post_sale_preference: Database["public"]["Enums"]["post_sale_client_preference"]
          post_sale_preference_reason: string | null
          post_sale_preference_updated_at: string | null
          post_sale_preference_updated_by: string | null
          state: string | null
          status: string
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          birth_date?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          instagram?: string | null
          neighborhood?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          post_sale_preference?: Database["public"]["Enums"]["post_sale_client_preference"]
          post_sale_preference_reason?: string | null
          post_sale_preference_updated_at?: string | null
          post_sale_preference_updated_by?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          birth_date?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          instagram?: string | null
          neighborhood?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          post_sale_preference?: Database["public"]["Enums"]["post_sale_client_preference"]
          post_sale_preference_reason?: string | null
          post_sale_preference_updated_at?: string | null
          post_sale_preference_updated_by?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      couriers: {
        Row: {
          active: boolean
          created_at: string
          document: string | null
          full_name: string
          id: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          user_id: string | null
          vehicle_plate: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          document?: string | null
          full_name: string
          id?: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          document?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couriers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_counters: {
        Row: {
          next_number: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_new_items: {
        Row: {
          barcode_snapshot: string | null
          color_snapshot: string | null
          created_at: string
          discount_total: number
          exchange_id: string
          id: string
          organization_id: string
          original_unit_price: number
          product_id: string
          product_name_snapshot: string | null
          quantity: number
          size_snapshot: string | null
          sku_snapshot: string | null
          total: number
          unit_price: number
          variant_id: string
        }
        Insert: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          created_at?: string
          discount_total?: number
          exchange_id: string
          id?: string
          organization_id: string
          original_unit_price: number
          product_id: string
          product_name_snapshot?: string | null
          quantity: number
          size_snapshot?: string | null
          sku_snapshot?: string | null
          total: number
          unit_price: number
          variant_id: string
        }
        Update: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          created_at?: string
          discount_total?: number
          exchange_id?: string
          id?: string
          organization_id?: string
          original_unit_price?: number
          product_id?: string
          product_name_snapshot?: string | null
          quantity?: number
          size_snapshot?: string | null
          sku_snapshot?: string | null
          total?: number
          unit_price?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_new_items_exchange_id_fkey"
            columns: ["exchange_id"]
            isOneToOne: false
            referencedRelation: "exchanges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_new_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_new_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_new_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_payments: {
        Row: {
          amount: number
          authorization_code: string | null
          card_brand: string | null
          cash_session_id: string | null
          created_at: string
          direction: Database["public"]["Enums"]["exchange_pay_direction"]
          exchange_id: string
          id: string
          installments: number
          notes: string | null
          organization_id: string
          payment_method: string
          status: string
          transaction_reference: string | null
        }
        Insert: {
          amount: number
          authorization_code?: string | null
          card_brand?: string | null
          cash_session_id?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["exchange_pay_direction"]
          exchange_id: string
          id?: string
          installments?: number
          notes?: string | null
          organization_id: string
          payment_method: string
          status?: string
          transaction_reference?: string | null
        }
        Update: {
          amount?: number
          authorization_code?: string | null
          card_brand?: string | null
          cash_session_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["exchange_pay_direction"]
          exchange_id?: string
          id?: string
          installments?: number
          notes?: string | null
          organization_id?: string
          payment_method?: string
          status?: string
          transaction_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exchange_payments_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_payments_exchange_id_fkey"
            columns: ["exchange_id"]
            isOneToOne: false
            referencedRelation: "exchanges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_receipt_items: {
        Row: {
          barcode_snapshot: string | null
          color_snapshot: string | null
          created_at: string
          exchange_receipt_id: string
          id: string
          organization_id: string
          original_quantity: number
          product_name_snapshot: string | null
          remaining_quantity: number
          sale_item_id: string
          size_snapshot: string | null
          sku_snapshot: string | null
        }
        Insert: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          created_at?: string
          exchange_receipt_id: string
          id?: string
          organization_id: string
          original_quantity: number
          product_name_snapshot?: string | null
          remaining_quantity: number
          sale_item_id: string
          size_snapshot?: string | null
          sku_snapshot?: string | null
        }
        Update: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          created_at?: string
          exchange_receipt_id?: string
          id?: string
          organization_id?: string
          original_quantity?: number
          product_name_snapshot?: string | null
          remaining_quantity?: number
          sale_item_id?: string
          size_snapshot?: string | null
          sku_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exchange_receipt_items_exchange_receipt_id_fkey"
            columns: ["exchange_receipt_id"]
            isOneToOne: false
            referencedRelation: "exchange_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_receipt_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_receipt_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_receipts: {
        Row: {
          cancelled_by: string | null
          client_id: string | null
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          organization_id: string
          original_sale_id: string
          status: Database["public"]["Enums"]["receipt_status"]
          updated_at: string
        }
        Insert: {
          cancelled_by?: string | null
          client_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          organization_id: string
          original_sale_id: string
          status?: Database["public"]["Enums"]["receipt_status"]
          updated_at?: string
        }
        Update: {
          cancelled_by?: string | null
          client_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: string
          original_sale_id?: string
          status?: Database["public"]["Enums"]["receipt_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_receipts_original_sale_id_fkey"
            columns: ["original_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_return_items: {
        Row: {
          barcode_snapshot: string | null
          color_snapshot: string | null
          condition: Database["public"]["Enums"]["return_condition"]
          created_at: string
          exchange_id: string
          id: string
          notes: string | null
          organization_id: string
          original_sale_item_id: string | null
          product_id: string
          product_name_snapshot: string | null
          quantity: number
          reason: string | null
          restock_destination: Database["public"]["Enums"]["restock_destination"]
          restock_location_id: string | null
          return_to_available_stock: boolean
          size_snapshot: string | null
          sku_snapshot: string | null
          total_value: number
          unit_value: number
          variant_id: string
        }
        Insert: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          condition: Database["public"]["Enums"]["return_condition"]
          created_at?: string
          exchange_id: string
          id?: string
          notes?: string | null
          organization_id: string
          original_sale_item_id?: string | null
          product_id: string
          product_name_snapshot?: string | null
          quantity: number
          reason?: string | null
          restock_destination: Database["public"]["Enums"]["restock_destination"]
          restock_location_id?: string | null
          return_to_available_stock?: boolean
          size_snapshot?: string | null
          sku_snapshot?: string | null
          total_value: number
          unit_value: number
          variant_id: string
        }
        Update: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          condition?: Database["public"]["Enums"]["return_condition"]
          created_at?: string
          exchange_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          original_sale_item_id?: string | null
          product_id?: string
          product_name_snapshot?: string | null
          quantity?: number
          reason?: string | null
          restock_destination?: Database["public"]["Enums"]["restock_destination"]
          restock_location_id?: string | null
          return_to_available_stock?: boolean
          size_snapshot?: string | null
          sku_snapshot?: string | null
          total_value?: number
          unit_value?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_return_items_exchange_id_fkey"
            columns: ["exchange_id"]
            isOneToOne: false
            referencedRelation: "exchanges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_return_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_return_items_original_sale_item_id_fkey"
            columns: ["original_sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_return_items_restock_location_id_fkey"
            columns: ["restock_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_return_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_settings: {
        Row: {
          allow_bearer_voucher: boolean
          allow_exchange_more_than_once: boolean
          allow_exchange_voucher: boolean
          allow_partial_voucher_use: boolean
          allow_promotional_items: boolean
          allow_refund: boolean
          allow_return_without_customer: boolean
          allow_store_credit: boolean
          cheaper_item_balance_action: Database["public"]["Enums"]["cheaper_balance_action"]
          created_at: string
          default_return_destination: Database["public"]["Enums"]["restock_destination"]
          exchange_deadline_days: number
          id: string
          organization_id: string
          receipt_footer_text: string | null
          require_exchange_receipt: boolean
          require_manager_for_defective: boolean
          require_manager_for_expired: boolean
          require_manager_for_without_tag: boolean
          require_original_sale: boolean
          require_product_tag: boolean
          updated_at: string
        }
        Insert: {
          allow_bearer_voucher?: boolean
          allow_exchange_more_than_once?: boolean
          allow_exchange_voucher?: boolean
          allow_partial_voucher_use?: boolean
          allow_promotional_items?: boolean
          allow_refund?: boolean
          allow_return_without_customer?: boolean
          allow_store_credit?: boolean
          cheaper_item_balance_action?: Database["public"]["Enums"]["cheaper_balance_action"]
          created_at?: string
          default_return_destination?: Database["public"]["Enums"]["restock_destination"]
          exchange_deadline_days?: number
          id?: string
          organization_id: string
          receipt_footer_text?: string | null
          require_exchange_receipt?: boolean
          require_manager_for_defective?: boolean
          require_manager_for_expired?: boolean
          require_manager_for_without_tag?: boolean
          require_original_sale?: boolean
          require_product_tag?: boolean
          updated_at?: string
        }
        Update: {
          allow_bearer_voucher?: boolean
          allow_exchange_more_than_once?: boolean
          allow_exchange_voucher?: boolean
          allow_partial_voucher_use?: boolean
          allow_promotional_items?: boolean
          allow_refund?: boolean
          allow_return_without_customer?: boolean
          allow_store_credit?: boolean
          cheaper_item_balance_action?: Database["public"]["Enums"]["cheaper_balance_action"]
          created_at?: string
          default_return_destination?: Database["public"]["Enums"]["restock_destination"]
          exchange_deadline_days?: number
          id?: string
          organization_id?: string
          receipt_footer_text?: string | null
          require_exchange_receipt?: boolean
          require_manager_for_defective?: boolean
          require_manager_for_expired?: boolean
          require_manager_for_without_tag?: boolean
          require_original_sale?: boolean
          require_product_tag?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_voucher_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          id: string
          organization_id: string
          reference_id: string | null
          reference_type: string | null
          type: string
          user_id: string | null
          voucher_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          id?: string
          organization_id: string
          reference_id?: string | null
          reference_type?: string | null
          type: string
          user_id?: string | null
          voucher_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          id?: string
          organization_id?: string
          reference_id?: string | null
          reference_type?: string | null
          type?: string
          user_id?: string | null
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_voucher_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_voucher_transactions_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "exchange_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_vouchers: {
        Row: {
          cancellation_reason: string | null
          cancelled_by: string | null
          client_id: string | null
          code: string
          created_at: string
          current_balance: number
          expires_at: string | null
          id: string
          initial_amount: number
          issued_by: string | null
          issued_from_exchange_id: string | null
          organization_id: string
          status: Database["public"]["Enums"]["voucher_status"]
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_by?: string | null
          client_id?: string | null
          code: string
          created_at?: string
          current_balance?: number
          expires_at?: string | null
          id?: string
          initial_amount: number
          issued_by?: string | null
          issued_from_exchange_id?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["voucher_status"]
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_by?: string | null
          client_id?: string | null
          code?: string
          created_at?: string
          current_balance?: number
          expires_at?: string | null
          id?: string
          initial_amount?: number
          issued_by?: string | null
          issued_from_exchange_id?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["voucher_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_vouchers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_vouchers_issued_from_exchange_id_fkey"
            columns: ["issued_from_exchange_id"]
            isOneToOne: false
            referencedRelation: "exchanges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_vouchers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exchanges: {
        Row: {
          additional_payment_amount: number
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cash_session_id: string | null
          client_id: string | null
          client_request_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          difference_amount: number
          exchange_number: number
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          original_sale_id: string | null
          reason: string | null
          refund_amount: number
          status: Database["public"]["Enums"]["exchange_status"]
          store_credit_amount: number
          subtotal_new_items: number
          subtotal_returned: number
          type: Database["public"]["Enums"]["exchange_type"]
          updated_at: string
          voucher_amount: number
        }
        Insert: {
          additional_payment_amount?: number
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cash_session_id?: string | null
          client_id?: string | null
          client_request_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          difference_amount?: number
          exchange_number: number
          id?: string
          location_id: string
          notes?: string | null
          organization_id: string
          original_sale_id?: string | null
          reason?: string | null
          refund_amount?: number
          status?: Database["public"]["Enums"]["exchange_status"]
          store_credit_amount?: number
          subtotal_new_items?: number
          subtotal_returned?: number
          type: Database["public"]["Enums"]["exchange_type"]
          updated_at?: string
          voucher_amount?: number
        }
        Update: {
          additional_payment_amount?: number
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cash_session_id?: string | null
          client_id?: string | null
          client_request_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          difference_amount?: number
          exchange_number?: number
          id?: string
          location_id?: string
          notes?: string | null
          organization_id?: string
          original_sale_id?: string | null
          reason?: string | null
          refund_amount?: number
          status?: Database["public"]["Enums"]["exchange_status"]
          store_credit_amount?: number
          subtotal_new_items?: number
          subtotal_returned?: number
          type?: Database["public"]["Enums"]["exchange_type"]
          updated_at?: string
          voucher_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "exchanges_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchanges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchanges_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchanges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchanges_original_sale_id_fkey"
            columns: ["original_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_counters: {
        Row: {
          next_number: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      goods_receipt_draft_items: {
        Row: {
          cells: Json
          created_at: string
          draft_id: string
          id: string
          mode: string
          new_product_data: Json | null
          new_variant_data: Json | null
          notes: string | null
          organization_id: string
          position: number
          product_id: string | null
          raw_color_label: string | null
          raw_counted_quantity: number | null
          raw_description: string | null
          raw_notes: string | null
          raw_size_label: string | null
          resolution_status: string
          resolved_at: string | null
          resolved_by: string | null
          total_quantity: number
          updated_at: string
        }
        Insert: {
          cells?: Json
          created_at?: string
          draft_id: string
          id?: string
          mode: string
          new_product_data?: Json | null
          new_variant_data?: Json | null
          notes?: string | null
          organization_id: string
          position?: number
          product_id?: string | null
          raw_color_label?: string | null
          raw_counted_quantity?: number | null
          raw_description?: string | null
          raw_notes?: string | null
          raw_size_label?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          total_quantity?: number
          updated_at?: string
        }
        Update: {
          cells?: Json
          created_at?: string
          draft_id?: string
          id?: string
          mode?: string
          new_product_data?: Json | null
          new_variant_data?: Json | null
          notes?: string | null
          organization_id?: string
          position?: number
          product_id?: string | null
          raw_color_label?: string | null
          raw_counted_quantity?: number | null
          raw_description?: string | null
          raw_notes?: string | null
          raw_size_label?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          total_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_draft_items_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_draft_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_draft_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_drafts: {
        Row: {
          cancellation_reason: string | null
          cancellation_request_id: string | null
          cancellation_summary: Json | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_request_id: string | null
          confirmation_request_id: string | null
          confirmation_summary: Json | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          invoice_number: string | null
          location_id: string | null
          notes: string | null
          order_number: string | null
          organization_id: string
          receipt_date: string
          receipt_number: number
          status: string
          sub_status: string | null
          supplier_id: string | null
          total_items: number
          total_quantity: number
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          cancellation_reason?: string | null
          cancellation_request_id?: string | null
          cancellation_summary?: Json | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_request_id?: string | null
          confirmation_request_id?: string | null
          confirmation_summary?: Json | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_number?: string | null
          location_id?: string | null
          notes?: string | null
          order_number?: string | null
          organization_id: string
          receipt_date?: string
          receipt_number: number
          status?: string
          sub_status?: string | null
          supplier_id?: string | null
          total_items?: number
          total_quantity?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          cancellation_reason?: string | null
          cancellation_request_id?: string | null
          cancellation_summary?: Json | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_request_id?: string | null
          confirmation_request_id?: string | null
          confirmation_summary?: Json | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_number?: string | null
          location_id?: string | null
          notes?: string | null
          order_number?: string | null
          organization_id?: string
          receipt_date?: string
          receipt_number?: number
          status?: string
          sub_status?: string | null
          supplier_id?: string | null
          total_items?: number
          total_quantity?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_drafts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_drafts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
      label_print_event_items: {
        Row: {
          confirmed_quantity: number
          created_at: string
          event_id: string
          id: string
          print_item_id: string
          requested_quantity: number
        }
        Insert: {
          confirmed_quantity?: number
          created_at?: string
          event_id: string
          id?: string
          print_item_id: string
          requested_quantity: number
        }
        Update: {
          confirmed_quantity?: number
          created_at?: string
          event_id?: string
          id?: string
          print_item_id?: string
          requested_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "label_print_event_items_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "label_print_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_event_items_print_item_id_fkey"
            columns: ["print_item_id"]
            isOneToOne: false
            referencedRelation: "label_print_items"
            referencedColumns: ["id"]
          },
        ]
      }
      label_print_events: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          client_request_id: string
          completed_at: string | null
          confirmed_total: number
          created_at: string
          expires_at: string | null
          id: string
          operation_type: string
          organization_id: string
          print_job_id: string
          reason: string | null
          requested_total: number
          status: string
          user_id: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_request_id: string
          completed_at?: string | null
          confirmed_total?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          operation_type: string
          organization_id: string
          print_job_id: string
          reason?: string | null
          requested_total?: number
          status?: string
          user_id?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_request_id?: string
          completed_at?: string | null
          confirmed_total?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          operation_type?: string
          organization_id?: string
          print_job_id?: string
          reason?: string | null
          requested_total?: number
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "label_print_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_events_print_job_id_fkey"
            columns: ["print_job_id"]
            isOneToOne: false
            referencedRelation: "label_print_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      label_print_items: {
        Row: {
          barcode_snapshot: string | null
          color_snapshot: string | null
          created_at: string
          id: string
          position: number
          price_snapshot: number | null
          print_job_id: string
          printed_quantity: number
          product_id: string | null
          product_name_snapshot: string
          quantity: number
          reprinted_quantity: number
          reserved_quantity: number
          size_snapshot: string | null
          sku_snapshot: string | null
          variant_id: string | null
        }
        Insert: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          created_at?: string
          id?: string
          position?: number
          price_snapshot?: number | null
          print_job_id: string
          printed_quantity?: number
          product_id?: string | null
          product_name_snapshot: string
          quantity?: number
          reprinted_quantity?: number
          reserved_quantity?: number
          size_snapshot?: string | null
          sku_snapshot?: string | null
          variant_id?: string | null
        }
        Update: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          created_at?: string
          id?: string
          position?: number
          price_snapshot?: number | null
          print_job_id?: string
          printed_quantity?: number
          product_id?: string | null
          product_name_snapshot?: string
          quantity?: number
          reprinted_quantity?: number
          reserved_quantity?: number
          size_snapshot?: string | null
          sku_snapshot?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "label_print_items_print_job_id_fkey"
            columns: ["print_job_id"]
            isOneToOne: false
            referencedRelation: "label_print_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      label_print_jobs: {
        Row: {
          client_request_id: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          generated_file_url: string | null
          goods_receipt_draft_id: string | null
          id: string
          location_id: string | null
          notes: string | null
          organization_id: string
          origin: string
          status: string
          supplier_id: string | null
          template_id: string | null
          total_labels: number
          user_id: string | null
        }
        Insert: {
          client_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          generated_file_url?: string | null
          goods_receipt_draft_id?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          organization_id: string
          origin?: string
          status?: string
          supplier_id?: string | null
          template_id?: string | null
          total_labels?: number
          user_id?: string | null
        }
        Update: {
          client_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          generated_file_url?: string | null
          goods_receipt_draft_id?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          organization_id?: string
          origin?: string
          status?: string
          supplier_id?: string | null
          template_id?: string | null
          total_labels?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "label_print_jobs_goods_receipt_draft_id_fkey"
            columns: ["goods_receipt_draft_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_jobs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_jobs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "label_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      label_templates: {
        Row: {
          barcode_type: string
          created_at: string
          font_family: string
          font_size: number
          height: number
          id: string
          is_default: boolean
          logo_url: string | null
          margin_bottom: number
          margin_left: number
          margin_right: number
          margin_top: number
          name: string
          organization_id: string
          show_barcode: boolean
          show_color: boolean
          show_name: boolean
          show_price: boolean
          show_promotional_price: boolean
          show_size: boolean
          show_sku: boolean
          status: string
          updated_at: string
          width: number
        }
        Insert: {
          barcode_type?: string
          created_at?: string
          font_family?: string
          font_size?: number
          height?: number
          id?: string
          is_default?: boolean
          logo_url?: string | null
          margin_bottom?: number
          margin_left?: number
          margin_right?: number
          margin_top?: number
          name: string
          organization_id: string
          show_barcode?: boolean
          show_color?: boolean
          show_name?: boolean
          show_price?: boolean
          show_promotional_price?: boolean
          show_size?: boolean
          show_sku?: boolean
          status?: string
          updated_at?: string
          width?: number
        }
        Update: {
          barcode_type?: string
          created_at?: string
          font_family?: string
          font_size?: number
          height?: number
          id?: string
          is_default?: boolean
          logo_url?: string | null
          margin_bottom?: number
          margin_left?: number
          margin_right?: number
          margin_top?: number
          name?: string
          organization_id?: string
          show_barcode?: boolean
          show_color?: boolean
          show_name?: boolean
          show_price?: boolean
          show_promotional_price?: boolean
          show_size?: boolean
          show_sku?: boolean
          status?: string
          updated_at?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "label_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_size_presets: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          organization_id: string
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          organization_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_size_presets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      post_sale_rules: {
        Row: {
          active: boolean
          allowed_end_time: string | null
          allowed_start_time: string | null
          business_days_only: boolean
          created_at: string
          created_by: string | null
          delay_unit: Database["public"]["Enums"]["post_sale_delay_unit"]
          delay_value: number
          delivery_methods: Json
          description: string | null
          exception_behavior: Json
          filters: Json
          id: string
          locations: Json
          name: string
          organization_id: string
          post_sale_type: Database["public"]["Enums"]["post_sale_type"]
          preferred_send_time: string | null
          priority: number
          responsible_role_id: string | null
          responsible_user_id: string | null
          review_required: boolean
          sales_channels: Json
          template_id: string | null
          timezone: string
          trigger_type: Database["public"]["Enums"]["post_sale_trigger"]
          updated_at: string
          updated_by: string | null
          working_days: number[] | null
        }
        Insert: {
          active?: boolean
          allowed_end_time?: string | null
          allowed_start_time?: string | null
          business_days_only?: boolean
          created_at?: string
          created_by?: string | null
          delay_unit?: Database["public"]["Enums"]["post_sale_delay_unit"]
          delay_value?: number
          delivery_methods?: Json
          description?: string | null
          exception_behavior?: Json
          filters?: Json
          id?: string
          locations?: Json
          name: string
          organization_id: string
          post_sale_type?: Database["public"]["Enums"]["post_sale_type"]
          preferred_send_time?: string | null
          priority?: number
          responsible_role_id?: string | null
          responsible_user_id?: string | null
          review_required?: boolean
          sales_channels?: Json
          template_id?: string | null
          timezone?: string
          trigger_type?: Database["public"]["Enums"]["post_sale_trigger"]
          updated_at?: string
          updated_by?: string | null
          working_days?: number[] | null
        }
        Update: {
          active?: boolean
          allowed_end_time?: string | null
          allowed_start_time?: string | null
          business_days_only?: boolean
          created_at?: string
          created_by?: string | null
          delay_unit?: Database["public"]["Enums"]["post_sale_delay_unit"]
          delay_value?: number
          delivery_methods?: Json
          description?: string | null
          exception_behavior?: Json
          filters?: Json
          id?: string
          locations?: Json
          name?: string
          organization_id?: string
          post_sale_type?: Database["public"]["Enums"]["post_sale_type"]
          preferred_send_time?: string | null
          priority?: number
          responsible_role_id?: string | null
          responsible_user_id?: string | null
          review_required?: boolean
          sales_channels?: Json
          template_id?: string | null
          timezone?: string
          trigger_type?: Database["public"]["Enums"]["post_sale_trigger"]
          updated_at?: string
          updated_by?: string | null
          working_days?: number[] | null
        }
        Relationships: []
      }
      post_sale_settings: {
        Row: {
          allowed_end_time: string
          allowed_start_time: string
          created_at: string
          default_send_time: string
          default_template_id: string | null
          enabled: boolean
          operation_mode: Database["public"]["Enums"]["post_sale_operation_mode"]
          organization_id: string
          updated_at: string
          use_business_days: boolean
          working_days: number[]
        }
        Insert: {
          allowed_end_time?: string
          allowed_start_time?: string
          created_at?: string
          default_send_time?: string
          default_template_id?: string | null
          enabled?: boolean
          operation_mode?: Database["public"]["Enums"]["post_sale_operation_mode"]
          organization_id: string
          updated_at?: string
          use_business_days?: boolean
          working_days?: number[]
        }
        Update: {
          allowed_end_time?: string
          allowed_start_time?: string
          created_at?: string
          default_send_time?: string
          default_template_id?: string | null
          enabled?: boolean
          operation_mode?: Database["public"]["Enums"]["post_sale_operation_mode"]
          organization_id?: string
          updated_at?: string
          use_business_days?: boolean
          working_days?: number[]
        }
        Relationships: []
      }
      post_sale_task_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          organization_id: string
          task_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          organization_id: string
          task_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          organization_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_sale_task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "post_sale_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      post_sale_tasks: {
        Row: {
          cancelled_at: string | null
          client_id: string | null
          completed_by: string | null
          created_at: string
          edited_message: string | null
          id: string
          invalid_phone_at: string | null
          metadata: Json
          notes: string | null
          opened_at: string | null
          opted_out_at: string | null
          organization_id: string
          original_message: string | null
          phone: string | null
          post_sale_type: Database["public"]["Enums"]["post_sale_type"]
          recipient_name: string | null
          rendered_message: string
          responsible_user_id: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          route_id: string | null
          rule_id: string | null
          sale_id: string
          scheduled_at: string | null
          sent_at: string | null
          shipment_id: string | null
          skipped_at: string | null
          source: Database["public"]["Enums"]["post_sale_source"]
          status: Database["public"]["Enums"]["post_sale_status"]
          template_id: string | null
          trigger_event: string | null
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          client_id?: string | null
          completed_by?: string | null
          created_at?: string
          edited_message?: string | null
          id?: string
          invalid_phone_at?: string | null
          metadata?: Json
          notes?: string | null
          opened_at?: string | null
          opted_out_at?: string | null
          organization_id: string
          original_message?: string | null
          phone?: string | null
          post_sale_type: Database["public"]["Enums"]["post_sale_type"]
          recipient_name?: string | null
          rendered_message: string
          responsible_user_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          route_id?: string | null
          rule_id?: string | null
          sale_id: string
          scheduled_at?: string | null
          sent_at?: string | null
          shipment_id?: string | null
          skipped_at?: string | null
          source?: Database["public"]["Enums"]["post_sale_source"]
          status?: Database["public"]["Enums"]["post_sale_status"]
          template_id?: string | null
          trigger_event?: string | null
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          client_id?: string | null
          completed_by?: string | null
          created_at?: string
          edited_message?: string | null
          id?: string
          invalid_phone_at?: string | null
          metadata?: Json
          notes?: string | null
          opened_at?: string | null
          opted_out_at?: string | null
          organization_id?: string
          original_message?: string | null
          phone?: string | null
          post_sale_type?: Database["public"]["Enums"]["post_sale_type"]
          recipient_name?: string | null
          rendered_message?: string
          responsible_user_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          route_id?: string | null
          rule_id?: string | null
          sale_id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          shipment_id?: string | null
          skipped_at?: string | null
          source?: Database["public"]["Enums"]["post_sale_source"]
          status?: Database["public"]["Enums"]["post_sale_status"]
          template_id?: string | null
          trigger_event?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      post_sale_templates: {
        Row: {
          active: boolean
          allowed_channels: Json
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_notes: string | null
          is_default: boolean
          message: string
          name: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          allowed_channels?: Json
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_notes?: string | null
          is_default?: boolean
          message: string
          name: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          allowed_channels?: Json
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_notes?: string | null
          is_default?: boolean
          message?: string
          name?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
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
          color: string | null
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
          color?: string | null
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
          color?: string | null
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
          code: string | null
          created_at: string
          description: string | null
          id: string
          is_system_role: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_system_role?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_system_role?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
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
      route_counters: {
        Row: {
          last_number: number
          organization_id: string
        }
        Insert: {
          last_number?: number
          organization_id: string
        }
        Update: {
          last_number?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          courier_id: string
          created_at: string
          created_by: string | null
          dispatched_at: string | null
          id: string
          notes: string | null
          organization_id: string
          origin_location_id: string | null
          planned_departure: string | null
          route_date: string
          route_number: number
          status: Database["public"]["Enums"]["route_status"]
          total_stops: number
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          courier_id: string
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          origin_location_id?: string | null
          planned_departure?: string | null
          route_date: string
          route_number: number
          status?: Database["public"]["Enums"]["route_status"]
          total_stops?: number
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          courier_id?: string
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          origin_location_id?: string | null
          planned_departure?: string | null
          route_date?: string
          route_number?: number
          status?: Database["public"]["Enums"]["route_status"]
          total_stops?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_origin_location_id_fkey"
            columns: ["origin_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_counters: {
        Row: {
          next_number: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_delivery_preferences: {
        Row: {
          address: string | null
          address_complement: string | null
          address_number: string | null
          amount_to_collect: number | null
          change_for_amount: number | null
          city: string | null
          created_at: string
          delivery_method: Database["public"]["Enums"]["delivery_method"]
          latitude: number | null
          longitude: number | null
          neighborhood: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          recipient_name: string | null
          reference: string | null
          sale_id: string
          scheduled_date: string | null
          scheduled_window: string | null
          state: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          amount_to_collect?: number | null
          change_for_amount?: number | null
          city?: string | null
          created_at?: string
          delivery_method: Database["public"]["Enums"]["delivery_method"]
          latitude?: number | null
          longitude?: number | null
          neighborhood?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          recipient_name?: string | null
          reference?: string | null
          sale_id: string
          scheduled_date?: string | null
          scheduled_window?: string | null
          state?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          amount_to_collect?: number | null
          change_for_amount?: number | null
          city?: string | null
          created_at?: string
          delivery_method?: Database["public"]["Enums"]["delivery_method"]
          latitude?: number | null
          longitude?: number | null
          neighborhood?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          recipient_name?: string | null
          reference?: string | null
          sale_id?: string
          scheduled_date?: string | null
          scheduled_window?: string | null
          state?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_delivery_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_delivery_preferences_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          barcode_snapshot: string | null
          color_snapshot: string | null
          created_at: string
          discount_total: number
          discount_type: string | null
          discount_value: number
          id: string
          organization_id: string
          original_unit_price: number
          product_id: string | null
          product_name_snapshot: string
          quantity: number
          sale_id: string
          size_snapshot: string | null
          sku_snapshot: string | null
          total: number
          unit_cost_snapshot: number | null
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          created_at?: string
          discount_total?: number
          discount_type?: string | null
          discount_value?: number
          id?: string
          organization_id: string
          original_unit_price: number
          product_id?: string | null
          product_name_snapshot: string
          quantity: number
          sale_id: string
          size_snapshot?: string | null
          sku_snapshot?: string | null
          total: number
          unit_cost_snapshot?: number | null
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          barcode_snapshot?: string | null
          color_snapshot?: string | null
          created_at?: string
          discount_total?: number
          discount_type?: string | null
          discount_value?: number
          id?: string
          organization_id?: string
          original_unit_price?: number
          product_id?: string | null
          product_name_snapshot?: string
          quantity?: number
          sale_id?: string
          size_snapshot?: string | null
          sku_snapshot?: string | null
          total?: number
          unit_cost_snapshot?: number | null
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payments: {
        Row: {
          amount: number
          authorization_code: string | null
          card_brand: string | null
          cash_session_id: string | null
          created_at: string
          id: string
          installments: number
          notes: string | null
          organization_id: string
          payment_method: string
          refund_reason: string | null
          refunded_amount: number
          refunded_at: string | null
          refunded_by: string | null
          sale_id: string
          status: string
          transaction_reference: string | null
        }
        Insert: {
          amount: number
          authorization_code?: string | null
          card_brand?: string | null
          cash_session_id?: string | null
          created_at?: string
          id?: string
          installments?: number
          notes?: string | null
          organization_id: string
          payment_method: string
          refund_reason?: string | null
          refunded_amount?: number
          refunded_at?: string | null
          refunded_by?: string | null
          sale_id: string
          status?: string
          transaction_reference?: string | null
        }
        Update: {
          amount?: number
          authorization_code?: string | null
          card_brand?: string | null
          cash_session_id?: string | null
          created_at?: string
          id?: string
          installments?: number
          notes?: string | null
          organization_id?: string
          payment_method?: string
          refund_reason?: string | null
          refunded_amount?: number
          refunded_at?: string | null
          refunded_by?: string | null
          sale_id?: string
          status?: string
          transaction_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_payments_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount_paid: number
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cash_session_id: string | null
          cashier_id: string | null
          change_amount: number
          channel: string
          client_id: string | null
          client_request_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          item_discount_total: number
          location_id: string
          notes: string | null
          order_discount_total: number
          organization_id: string
          sale_number: number
          seller_id: string | null
          status: string
          subtotal: number
          surcharge_total: number
          total: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_session_id?: string | null
          cashier_id?: string | null
          change_amount?: number
          channel?: string
          client_id?: string | null
          client_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          item_discount_total?: number
          location_id: string
          notes?: string | null
          order_discount_total?: number
          organization_id: string
          sale_number: number
          seller_id?: string | null
          status?: string
          subtotal?: number
          surcharge_total?: number
          total?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_session_id?: string | null
          cashier_id?: string | null
          change_amount?: number
          channel?: string
          client_id?: string | null
          client_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          item_discount_total?: number
          location_id?: string
          notes?: string | null
          order_discount_total?: number
          organization_id?: string
          sale_number?: number
          seller_id?: string | null
          status?: string
          subtotal?: number
          surcharge_total?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_counters: {
        Row: {
          last_number: number
          organization_id: string
        }
        Insert: {
          last_number?: number
          organization_id: string
        }
        Update: {
          last_number?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_status: Database["public"]["Enums"]["shipment_status"] | null
          id: string
          metadata: Json
          notes: string | null
          organization_id: string
          shipment_id: string
          to_status: Database["public"]["Enums"]["shipment_status"] | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_status?: Database["public"]["Enums"]["shipment_status"] | null
          id?: string
          metadata?: Json
          notes?: string | null
          organization_id: string
          shipment_id: string
          to_status?: Database["public"]["Enums"]["shipment_status"] | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: Database["public"]["Enums"]["shipment_status"] | null
          id?: string
          metadata?: Json
          notes?: string | null
          organization_id?: string
          shipment_id?: string
          to_status?: Database["public"]["Enums"]["shipment_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          address: string | null
          address_complement: string | null
          address_number: string | null
          amount_to_collect: number
          change_for_amount: number | null
          city: string | null
          client_id: string | null
          courier_id: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          dispatched_at: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          latitude: number | null
          longitude: number | null
          neighborhood: string | null
          notes: string | null
          organization_id: string
          payment_summary: Json
          phone: string | null
          recipient_name: string
          reference: string | null
          route_id: string | null
          sale_id: string | null
          scheduled_date: string
          scheduled_departure_time: string | null
          scheduled_window: string | null
          shipment_number: number
          state: string | null
          status: Database["public"]["Enums"]["shipment_status"]
          stop_order: number | null
          updated_at: string
          updated_by: string | null
          whatsapp_sent_at: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          amount_to_collect?: number
          change_for_amount?: number | null
          city?: string | null
          client_id?: string | null
          courier_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          dispatched_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          neighborhood?: string | null
          notes?: string | null
          organization_id: string
          payment_summary?: Json
          phone?: string | null
          recipient_name: string
          reference?: string | null
          route_id?: string | null
          sale_id?: string | null
          scheduled_date: string
          scheduled_departure_time?: string | null
          scheduled_window?: string | null
          shipment_number: number
          state?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          stop_order?: number | null
          updated_at?: string
          updated_by?: string | null
          whatsapp_sent_at?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          amount_to_collect?: number
          change_for_amount?: number | null
          city?: string | null
          client_id?: string | null
          courier_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          dispatched_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          neighborhood?: string | null
          notes?: string | null
          organization_id?: string
          payment_summary?: Json
          phone?: string | null
          recipient_name?: string
          reference?: string | null
          route_id?: string | null
          sale_id?: string | null
          scheduled_date?: string
          scheduled_departure_time?: string | null
          scheduled_window?: string | null
          shipment_number?: number
          state?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          stop_order?: number | null
          updated_at?: string
          updated_by?: string | null
          whatsapp_sent_at?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          holiday_date: string
          id: string
          label: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          holiday_date: string
          id?: string
          label: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          id?: string
          label?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_settings: {
        Row: {
          cutoff_time: string
          default_departure_time: string
          default_origin_location_id: string | null
          organization_id: string
          organization_timezone: string
          updated_at: string
          updated_by: string | null
          whatsapp_template: string | null
          working_days: number[]
        }
        Insert: {
          cutoff_time?: string
          default_departure_time?: string
          default_origin_location_id?: string | null
          organization_id: string
          organization_timezone?: string
          updated_at?: string
          updated_by?: string | null
          whatsapp_template?: string | null
          working_days?: number[]
        }
        Update: {
          cutoff_time?: string
          default_departure_time?: string
          default_origin_location_id?: string | null
          organization_id?: string
          organization_timezone?: string
          updated_at?: string
          updated_by?: string | null
          whatsapp_template?: string | null
          working_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "shipping_settings_default_origin_location_id_fkey"
            columns: ["default_origin_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
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
      store_credit_accounts: {
        Row: {
          balance: number
          client_id: string
          created_at: string
          id: string
          organization_id: string
          status: Database["public"]["Enums"]["credit_account_status"]
          updated_at: string
        }
        Insert: {
          balance?: number
          client_id: string
          created_at?: string
          id?: string
          organization_id: string
          status?: Database["public"]["Enums"]["credit_account_status"]
          updated_at?: string
        }
        Update: {
          balance?: number
          client_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["credit_account_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_credit_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_credit_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      store_credit_transactions: {
        Row: {
          account_id: string
          amount: number
          balance_after: number
          balance_before: number
          client_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          organization_id: string
          reason: string | null
          reference_id: string | null
          reference_type: string | null
          type: string
        }
        Insert: {
          account_id: string
          amount: number
          balance_after: number
          balance_before: number
          client_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          organization_id: string
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          type: string
        }
        Update: {
          account_id?: string
          amount?: number
          balance_after?: number
          balance_before?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: string
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_credit_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "store_credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_credit_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_credit_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      _expire_stale_label_events: {
        Args: { _job_id: string }
        Returns: undefined
      }
      _filter_exchanges: {
        Args: { _filters: Json; _org: string }
        Returns: {
          id: string
        }[]
      }
      _is_admin_role: { Args: { _role_id: string }; Returns: boolean }
      _next_route_number: { Args: { _org: string }; Returns: number }
      _next_shipment_number: { Args: { _org: string }; Returns: number }
      _org_admin_count: { Args: { _org: string }; Returns: number }
      _post_sale_calc_scheduled: {
        Args: {
          _base: string
          _delay: number
          _unit: Database["public"]["Enums"]["post_sale_delay_unit"]
        }
        Returns: string
      }
      _post_sale_get_task: {
        Args: { _task_id: string }
        Returns: {
          cancelled_at: string | null
          client_id: string | null
          completed_by: string | null
          created_at: string
          edited_message: string | null
          id: string
          invalid_phone_at: string | null
          metadata: Json
          notes: string | null
          opened_at: string | null
          opted_out_at: string | null
          organization_id: string
          original_message: string | null
          phone: string | null
          post_sale_type: Database["public"]["Enums"]["post_sale_type"]
          recipient_name: string | null
          rendered_message: string
          responsible_user_id: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          route_id: string | null
          rule_id: string | null
          sale_id: string
          scheduled_at: string | null
          sent_at: string | null
          shipment_id: string | null
          skipped_at: string | null
          source: Database["public"]["Enums"]["post_sale_source"]
          status: Database["public"]["Enums"]["post_sale_status"]
          template_id: string | null
          trigger_event: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_sale_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _post_sale_normalize_phone: { Args: { p: string }; Returns: string }
      _post_sale_render_message: {
        Args: { _client_id: string; _sale_id: string; _template: string }
        Returns: string
      }
      _recompute_label_job_status: {
        Args: { _job_id: string }
        Returns: string
      }
      _sale_effective_paid: { Args: { _sale_id: string }; Returns: number }
      _sale_effective_payments_json: {
        Args: { _sale_id: string }
        Returns: Json
      }
      _shipment_log: {
        Args: {
          _event: string
          _from: Database["public"]["Enums"]["shipment_status"]
          _meta: Json
          _notes: string
          _shipment_id: string
          _to: Database["public"]["Enums"]["shipment_status"]
        }
        Returns: undefined
      }
      add_shipment_to_route: {
        Args: { _route_id: string; _shipment_id: string }
        Returns: undefined
      }
      admin_dashboard_stats: { Args: never; Returns: Json }
      advance_shipment_status: {
        Args: {
          _notes?: string
          _shipment_id: string
          _to: Database["public"]["Enums"]["shipment_status"]
        }
        Returns: undefined
      }
      apply_post_sale_rules_for_event: {
        Args: { _event: string; _sale_id: string }
        Returns: Json
      }
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
      assert_pos_payment_allowed: {
        Args: { _method: string }
        Returns: undefined
      }
      assign_courier: {
        Args: { _courier_id: string; _shipment_id: string }
        Returns: undefined
      }
      assign_employee_role: {
        Args: { _role_id: string; _user_id: string }
        Returns: undefined
      }
      cancel_goods_receipt_draft: {
        Args: {
          _client_request_id: string
          _draft_id: string
          _expected_version: number
          _reason: string
        }
        Returns: Json
      }
      cancel_goods_receipt_label_print: {
        Args: { _event_id: string; _reason: string }
        Returns: Json
      }
      cancel_route: {
        Args: { _reason: string; _route_id: string }
        Returns: undefined
      }
      close_cash_session: {
        Args: { _counted_amount: number; _notes?: string; _session_id: string }
        Returns: Json
      }
      complete_exchange: { Args: { _payload: Json }; Returns: Json }
      complete_goods_receipt_label_print: {
        Args: { _client_request_id: string; _event_id: string }
        Returns: Json
      }
      complete_pos_sale: { Args: { _payload: Json }; Returns: Json }
      complete_route: { Args: { _route_id: string }; Returns: undefined }
      compute_delivery_forecast: { Args: { _at?: string }; Returns: Json }
      compute_scheduled_date: {
        Args: { _at?: string; _org: string }
        Returns: string
      }
      configure_courier_user_access: {
        Args: { _courier_id: string; _mode: string }
        Returns: undefined
      }
      confirm_goods_receipt: {
        Args: { _client_request_id: string; _draft_id: string }
        Returns: Json
      }
      courier_access_status: {
        Args: { _courier_id: string }
        Returns: {
          badge: string
          courier_id: string
          has_deliver: boolean
          has_view_own: boolean
          user_id: string
          user_status: string
        }[]
      }
      create_courier: {
        Args: {
          _document?: string
          _full_name: string
          _notes?: string
          _phone?: string
          _user_id?: string
          _vehicle_plate?: string
        }
        Returns: string
      }
      create_organization: {
        Args: { _document?: string; _name: string }
        Returns: string
      }
      create_post_sale_task: {
        Args: {
          _force?: boolean
          _phone_override?: string
          _post_sale_type: Database["public"]["Enums"]["post_sale_type"]
          _responsible_user_id?: string
          _rule_id?: string
          _sale_id: string
          _scheduled_at: string
          _source?: Database["public"]["Enums"]["post_sale_source"]
          _template_id: string
        }
        Returns: string
      }
      create_shipment_from_sale: {
        Args: {
          _address_override?: Json
          _change_for_amount?: number
          _delivery_method: Database["public"]["Enums"]["delivery_method"]
          _notes?: string
          _sale_id: string
          _scheduled_hint?: string
        }
        Returns: string
      }
      current_org_id: { Args: never; Returns: string }
      default_workspace_for_current_user: { Args: never; Returns: string }
      dispatch_and_start_route: {
        Args: { _route_id: string }
        Returns: undefined
      }
      dispatch_route: { Args: { _route_id: string }; Returns: undefined }
      ensure_system_roles: { Args: { _org: string }; Returns: undefined }
      export_exchanges_report: { Args: { _filters: Json }; Returns: Json }
      finalize_employee_invite: {
        Args: {
          _email: string
          _full_name: string
          _phone: string
          _role_id: string
          _user_id: string
        }
        Returns: undefined
      }
      generate_goods_receipt_labels: {
        Args: { _client_request_id: string; _receipt_id: string }
        Returns: Json
      }
      generate_post_sale_batch: {
        Args: {
          _post_sale_type: Database["public"]["Enums"]["post_sale_type"]
          _responsible_user_id?: string
          _sale_ids: string[]
          _scheduled_at: string
          _template_id: string
        }
        Returns: Json
      }
      generate_route: {
        Args: {
          _courier_id: string
          _notes?: string
          _origin_location_id?: string
          _planned_departure?: string
          _route_date: string
          _shipment_ids: string[]
        }
        Returns: string
      }
      has_permission: { Args: { _code: string }; Returns: boolean }
      has_role: { Args: { _role_name: string }; Returns: boolean }
      include_shipment_in_open_route: {
        Args: { _reason: string; _route_id: string; _shipment_id: string }
        Returns: string
      }
      is_active: { Args: never; Returns: boolean }
      is_business_day: { Args: { _d: string; _org: string }; Returns: boolean }
      issue_exchange_receipt: {
        Args: { _items: Json; _sale_id: string }
        Returns: string
      }
      link_courier_user: {
        Args: { _courier_id: string; _user_id: string }
        Returns: undefined
      }
      list_available_shipments_for_route: {
        Args: { _route_id: string }
        Returns: {
          city: string
          id: string
          neighborhood: string
          recipient_name: string
          sale_number: number
          scheduled_date: string
          shipment_number: number
          status: Database["public"]["Enums"]["shipment_status"]
        }[]
      }
      list_goods_receipts: { Args: { _filters: Json }; Returns: Json }
      list_open_routes_today: {
        Args: never
        Returns: {
          courier_id: string
          courier_name: string
          id: string
          planned_departure: string
          route_number: number
          status: Database["public"]["Enums"]["route_status"]
          total_stops: number
        }[]
      }
      list_pending_deliveries: {
        Args: never
        Returns: {
          client_id: string
          client_name: string
          reason: string
          sale_date: string
          sale_id: string
          sale_number: number
          seller: string
          total: number
        }[]
      }
      mark_shipment_absent: {
        Args: { _notes: string; _shipment_id: string }
        Returns: undefined
      }
      mark_shipment_delivered: {
        Args: { _notes?: string; _shipment_id: string }
        Returns: undefined
      }
      mark_shipment_failed: {
        Args: { _notes: string; _shipment_id: string }
        Returns: undefined
      }
      next_business_day: {
        Args: { _from: string; _org: string }
        Returns: string
      }
      next_exchange_number: { Args: { _org: string }; Returns: number }
      next_goods_receipt_number: { Args: { _org: string }; Returns: number }
      next_sale_number: { Args: { _org: string }; Returns: number }
      open_cash_session: {
        Args: { _location_id: string; _notes?: string; _opening_amount: number }
        Returns: string
      }
      post_sale_assign: {
        Args: { _task_id: string; _user_id: string }
        Returns: undefined
      }
      post_sale_cancel: {
        Args: { _reason?: string; _task_id: string }
        Returns: undefined
      }
      post_sale_change_template: {
        Args: { _task_id: string; _template_id: string }
        Returns: undefined
      }
      post_sale_edit_message: {
        Args: { _message: string; _task_id: string }
        Returns: undefined
      }
      post_sale_ensure_defaults: { Args: never; Returns: undefined }
      post_sale_mark_invalid_phone: {
        Args: { _task_id: string }
        Returns: undefined
      }
      post_sale_mark_opened: { Args: { _task_id: string }; Returns: undefined }
      post_sale_mark_sent: { Args: { _task_id: string }; Returns: undefined }
      post_sale_opt_out_client: {
        Args: { _reason?: string; _task_id: string }
        Returns: undefined
      }
      post_sale_preview_message: {
        Args: { _sale_id: string; _template: string }
        Returns: Json
      }
      post_sale_queue_stats: { Args: never; Returns: Json }
      post_sale_reschedule: {
        Args: { _new_at: string; _task_id: string }
        Returns: undefined
      }
      post_sale_review_approve: {
        Args: { _edited_message?: string; _task_id: string }
        Returns: undefined
      }
      post_sale_review_reject: {
        Args: { _reason?: string; _task_id: string }
        Returns: undefined
      }
      post_sale_save_rule: {
        Args: { _data: Json; _id: string }
        Returns: string
      }
      post_sale_save_template: {
        Args: { _data: Json; _id: string }
        Returns: string
      }
      post_sale_skip: {
        Args: { _reason?: string; _task_id: string }
        Returns: undefined
      }
      post_sale_upsert_settings: { Args: { _data: Json }; Returns: undefined }
      post_sale_validate_placeholders: {
        Args: { _template: string }
        Returns: Json
      }
      prepare_goods_receipt_label_print: {
        Args: {
          _client_request_id: string
          _items: Json
          _job_id: string
          _operation_type: string
          _reason?: string
        }
        Returns: Json
      }
      process_due_post_sale_rules: { Args: never; Returns: Json }
      record_payment_refund: {
        Args: { _amount: number; _payment_id: string; _reason?: string }
        Returns: undefined
      }
      refresh_shipment_payment_summary: {
        Args: { _shipment_id: string }
        Returns: undefined
      }
      register_cash_movement: {
        Args: {
          _amount: number
          _reason: string
          _session_id: string
          _type: string
        }
        Returns: string
      }
      remove_employee_access: { Args: { _user_id: string }; Returns: undefined }
      remove_shipment_from_route: {
        Args: { _shipment_id: string }
        Returns: undefined
      }
      reorder_route_stops: {
        Args: { _ordered_shipment_ids: string[]; _route_id: string }
        Returns: undefined
      }
      report_exchanges: { Args: { _filters: Json }; Returns: Json }
      reschedule_shipment: {
        Args: { _new_date: string; _notes: string; _shipment_id: string }
        Returns: undefined
      }
      resolve_goods_receipt_scan: { Args: { _code: string }; Returns: Json }
      reverse_exchange: {
        Args: { _exchange_id: string; _reason: string }
        Returns: Json
      }
      revoke_courier_access: {
        Args: { _courier_id: string }
        Returns: undefined
      }
      revoke_employee_role: {
        Args: { _role_id: string; _user_id: string }
        Returns: undefined
      }
      run_exchange_tests: {
        Args: never
        Returns: {
          detail: string
          result: string
          test_name: string
        }[]
      }
      save_goods_receipt_draft: { Args: { _payload: Json }; Returns: Json }
      set_courier_active: {
        Args: { _active: boolean; _id: string }
        Returns: undefined
      }
      set_employee_status: {
        Args: { _status: string; _user_id: string }
        Returns: undefined
      }
      start_route: { Args: { _route_id: string }; Returns: undefined }
      update_courier: {
        Args: {
          _document?: string
          _full_name: string
          _id: string
          _notes?: string
          _phone?: string
          _user_id?: string
          _vehicle_plate?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      cheaper_balance_action:
        | "store_credit"
        | "exchange_voucher"
        | "refund"
        | "forfeit"
        | "require_equal_or_higher_value"
      credit_account_status: "active" | "blocked" | "closed"
      delivery_method: "pickup" | "motoboy" | "correios" | "carrier" | "other"
      entity_status: "ativo" | "inativo"
      exchange_pay_direction: "incoming" | "outgoing"
      exchange_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "completed"
        | "cancelled"
      exchange_type: "exchange" | "return" | "partial_return" | "full_return"
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
      post_sale_client_preference: "allowed" | "unknown" | "opted_out"
      post_sale_delay_unit: "minutes" | "hours" | "days" | "business_days"
      post_sale_operation_mode:
        | "manual"
        | "automatic"
        | "automatic_review"
        | "hybrid"
      post_sale_source: "manual" | "rule" | "import" | "api"
      post_sale_status:
        | "draft"
        | "scheduled"
        | "pending_review"
        | "pending"
        | "opened"
        | "sent"
        | "skipped"
        | "rescheduled"
        | "cancelled"
        | "invalid_phone"
        | "opted_out"
      post_sale_trigger:
        | "sale_completed"
        | "sale_completed_store"
        | "sale_completed_online"
        | "pickup_registered"
        | "shipment_created"
        | "shipment_added_to_route"
        | "route_dispatched"
        | "delivery_completed"
        | "hours_after_sale"
        | "next_business_day_after_sale"
        | "next_business_day_after_dispatch"
        | "manual"
        | "custom_date"
      post_sale_type:
        | "thanks"
        | "satisfaction_service"
        | "satisfaction_delivery"
        | "arrival_check"
        | "exchange_followup"
        | "review_request"
        | "relationship"
        | "other"
      product_status: "ativo" | "inativo" | "rascunho"
      receipt_status:
        | "active"
        | "partially_used"
        | "used"
        | "expired"
        | "cancelled"
      reservation_status: "ativa" | "consumida" | "cancelada" | "expirada"
      restock_destination:
        | "available_stock"
        | "quarantine"
        | "damaged_stock"
        | "supplier_return"
        | "disposal"
        | "no_stock_return"
      return_condition:
        | "new"
        | "good"
        | "needs_review"
        | "without_tag"
        | "damaged"
        | "defective"
        | "used"
        | "supplier_return"
      route_status:
        | "draft"
        | "dispatched"
        | "in_progress"
        | "completed"
        | "cancelled"
      shipment_status:
        | "pending_pick"
        | "picking"
        | "ready"
        | "out_for_delivery"
        | "delivered"
        | "failed"
        | "customer_absent"
        | "rescheduled"
        | "cancelled"
      stock_location_type:
        | "loja"
        | "deposito"
        | "online"
        | "outros"
        | "quarentena_avariado"
        | "quarentena_defeituoso"
        | "perda"
      user_status:
        | "ativo"
        | "inativo"
        | "pendente"
        | "bloqueado"
        | "acesso_removido"
        | "convite_pendente"
      voucher_status: "active" | "fully_used" | "expired" | "cancelled"
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
      cheaper_balance_action: [
        "store_credit",
        "exchange_voucher",
        "refund",
        "forfeit",
        "require_equal_or_higher_value",
      ],
      credit_account_status: ["active", "blocked", "closed"],
      delivery_method: ["pickup", "motoboy", "correios", "carrier", "other"],
      entity_status: ["ativo", "inativo"],
      exchange_pay_direction: ["incoming", "outgoing"],
      exchange_status: [
        "draft",
        "pending_approval",
        "approved",
        "completed",
        "cancelled",
      ],
      exchange_type: ["exchange", "return", "partial_return", "full_return"],
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
      post_sale_client_preference: ["allowed", "unknown", "opted_out"],
      post_sale_delay_unit: ["minutes", "hours", "days", "business_days"],
      post_sale_operation_mode: [
        "manual",
        "automatic",
        "automatic_review",
        "hybrid",
      ],
      post_sale_source: ["manual", "rule", "import", "api"],
      post_sale_status: [
        "draft",
        "scheduled",
        "pending_review",
        "pending",
        "opened",
        "sent",
        "skipped",
        "rescheduled",
        "cancelled",
        "invalid_phone",
        "opted_out",
      ],
      post_sale_trigger: [
        "sale_completed",
        "sale_completed_store",
        "sale_completed_online",
        "pickup_registered",
        "shipment_created",
        "shipment_added_to_route",
        "route_dispatched",
        "delivery_completed",
        "hours_after_sale",
        "next_business_day_after_sale",
        "next_business_day_after_dispatch",
        "manual",
        "custom_date",
      ],
      post_sale_type: [
        "thanks",
        "satisfaction_service",
        "satisfaction_delivery",
        "arrival_check",
        "exchange_followup",
        "review_request",
        "relationship",
        "other",
      ],
      product_status: ["ativo", "inativo", "rascunho"],
      receipt_status: [
        "active",
        "partially_used",
        "used",
        "expired",
        "cancelled",
      ],
      reservation_status: ["ativa", "consumida", "cancelada", "expirada"],
      restock_destination: [
        "available_stock",
        "quarantine",
        "damaged_stock",
        "supplier_return",
        "disposal",
        "no_stock_return",
      ],
      return_condition: [
        "new",
        "good",
        "needs_review",
        "without_tag",
        "damaged",
        "defective",
        "used",
        "supplier_return",
      ],
      route_status: [
        "draft",
        "dispatched",
        "in_progress",
        "completed",
        "cancelled",
      ],
      shipment_status: [
        "pending_pick",
        "picking",
        "ready",
        "out_for_delivery",
        "delivered",
        "failed",
        "customer_absent",
        "rescheduled",
        "cancelled",
      ],
      stock_location_type: [
        "loja",
        "deposito",
        "online",
        "outros",
        "quarentena_avariado",
        "quarentena_defeituoso",
        "perda",
      ],
      user_status: [
        "ativo",
        "inativo",
        "pendente",
        "bloqueado",
        "acesso_removido",
        "convite_pendente",
      ],
      voucher_status: ["active", "fully_used", "expired", "cancelled"],
    },
  },
} as const

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ModelFormat = "onnx" | "pytorch" | "tensorflow" | "tflite" | "other";

type TableDef<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: TableDef<
        {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        }
      >;
      projects: TableDef<
        {
          id: string;
          name: string;
          description: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          name: string;
          description?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        },
        {
          name?: string;
          description?: string | null;
          updated_at?: string;
        }
      >;
      classes: TableDef<
        {
          id: string;
          project_id: string;
          name: string;
          color: string;
          description: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          project_id: string;
          name: string;
          color?: string;
          description?: string | null;
          sort_order?: number;
        },
        {
          name?: string;
          color?: string;
          description?: string | null;
          sort_order?: number;
        }
      >;
      datasets: TableDef<
        {
          id: string;
          project_id: string;
          name: string;
          description: string | null;
          file_count: number;
          total_size_bytes: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          project_id: string;
          name: string;
          description?: string | null;
          file_count?: number;
          total_size_bytes?: number;
          created_by: string;
        },
        {
          name?: string;
          description?: string | null;
          file_count?: number;
          total_size_bytes?: number;
        }
      >;
      dataset_files: TableDef<
        {
          id: string;
          dataset_id: string;
          project_id: string;
          class_id: string | null;
          file_name: string;
          file_path: string;
          file_size: number;
          mime_type: string | null;
          annotations: Json;
          auto_labeled_at: string | null;
          review_status: "pending" | "approved" | "rejected" | null;
          reviewed_at: string | null;
          created_at: string;
        },
        {
          id?: string;
          dataset_id: string;
          project_id: string;
          class_id?: string | null;
          file_name: string;
          file_path: string;
          file_size?: number;
          mime_type?: string | null;
          annotations?: Json;
          auto_labeled_at?: string | null;
          review_status?: "pending" | "approved" | "rejected" | null;
          reviewed_at?: string | null;
        },
        {
          class_id?: string | null;
          annotations?: Json;
          auto_labeled_at?: string | null;
          review_status?: "pending" | "approved" | "rejected" | null;
          reviewed_at?: string | null;
        }
      >;
      models: TableDef<
        {
          id: string;
          project_id: string;
          name: string;
          description: string | null;
          file_path: string;
          file_size: number;
          format: ModelFormat;
          version: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          project_id: string;
          name: string;
          description?: string | null;
          file_path: string;
          file_size?: number;
          format?: ModelFormat;
          version?: string;
          created_by: string;
        },
        {
          name?: string;
          description?: string | null;
          version?: string;
        }
      >;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      model_format: ModelFormat;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type Class = Database["public"]["Tables"]["classes"]["Row"];
export type Dataset = Database["public"]["Tables"]["datasets"]["Row"];
export type DatasetFile = Database["public"]["Tables"]["dataset_files"]["Row"];
export type Model = Database["public"]["Tables"]["models"]["Row"];

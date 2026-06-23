export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ModelFormat = "onnx" | "pytorch" | "tensorflow" | "tflite" | "other";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        };
      };
      projects: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          updated_at?: string;
        };
      };
      classes: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          color: string;
          description: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          color?: string;
          description?: string | null;
          sort_order?: number;
        };
        Update: {
          name?: string;
          color?: string;
          description?: string | null;
          sort_order?: number;
        };
      };
      datasets: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          description: string | null;
          file_count: number;
          total_size_bytes: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          description?: string | null;
          file_count?: number;
          total_size_bytes?: number;
          created_by: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          file_count?: number;
          total_size_bytes?: number;
        };
      };
      dataset_files: {
        Row: {
          id: string;
          dataset_id: string;
          project_id: string;
          class_id: string | null;
          file_name: string;
          file_path: string;
          file_size: number;
          mime_type: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          dataset_id: string;
          project_id: string;
          class_id?: string | null;
          file_name: string;
          file_path: string;
          file_size?: number;
          mime_type?: string | null;
        };
        Update: {
          class_id?: string | null;
        };
      };
      models: {
        Row: {
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
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          description?: string | null;
          file_path: string;
          file_size?: number;
          format?: ModelFormat;
          version?: string;
          created_by: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          version?: string;
        };
      };
    };
    Enums: {
      model_format: ModelFormat;
    };
  };
}

export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type Class = Database["public"]["Tables"]["classes"]["Row"];
export type Dataset = Database["public"]["Tables"]["datasets"]["Row"];
export type DatasetFile = Database["public"]["Tables"]["dataset_files"]["Row"];
export type Model = Database["public"]["Tables"]["models"]["Row"];

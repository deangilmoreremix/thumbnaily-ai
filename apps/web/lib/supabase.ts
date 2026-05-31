import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bzxohkrxcwodllketcpz.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  db: {
    schema: 'public',
  },
});

export type Database = {
  public: {
    Tables: {
      thumbnails: {
        Row: {
          id: string;
          prompt: string;
          image_url: string;
          is_public: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          prompt: string;
          image_url: string;
          is_public?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          prompt?: string;
          image_url?: string;
          is_public?: boolean;
          created_at?: string;
        };
      };
    };
  };
};
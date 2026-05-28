import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Inicializa o cliente do Supabase com as credenciais do projeto "Watic grupos"
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

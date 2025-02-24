import { createClient } from "@supabase/supabase-js";
// Generate the Typescript types using the Supabase CLI: https://supabase.com/docs/guides/api/rest/generating-types
import { Database } from "../database.types";

// Create a single Supabase client for interacting with your database
// 'Database' supplies the type definitions to supabase-js
export const supabase = createClient<Database>(
  // These details can be found in your Supabase project settings under `API`
  process.env.SUPABASE_PROJECT_URL as string, 
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);
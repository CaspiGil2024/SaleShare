import { createClient } from '@supabase/supabase-js';

// הכתובת והמפתח הציבורי מוזנים ישירות כדי למנוע בעיות של משתני סביבה ב-Netlify
const supabaseUrl = 'https://lwnrapffhosbfchtmsvy.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3bnJhcGZmaG9zYmZjaHRtc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NTU5OTIsImV4cCI6MjEwMzIzMTk5Mn0.o62f1vbMjMBXRmbNw4VcSI4WnfFlJXp04bmVbjjV8l4'; // או הכנס כאן את המפתח המלא שלך מ-Supabase

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
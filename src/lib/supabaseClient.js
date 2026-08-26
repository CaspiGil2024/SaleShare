import { createClient } from '@supabase/supabase-js';

// הכתובת והמפתח הציבורי מוזנים ישירות כדי למנוע בעיות של משתני סביבה ב-Netlify
const supabaseUrl = 'https://lwnrapffhosbfchtmsvy.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3bnJhcGZmaG9zYmZjaHRtc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMzg0NDUsImV4cCI6MjA1NjgxNDQ0NX0.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3bnJhcGZmaG9zYmZjaHRtc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMzg0NDUsImV4cCI6MjA1NjgxNDQ0NX0'; // או הכנס כאן את המפתח המלא שלך מ-Supabase

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
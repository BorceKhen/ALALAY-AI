-- -------------------------------------------------------------
-- SQL Schema: Profiles & Automated Trigger for Supabase Auth
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- -------------------------------------------------------------

-- Create a profiles table linked to Supabase Auth users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  disability_type TEXT,
  gender TEXT,
  birthdate DATE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row-Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- Row-Level Security (RLS) Policies
-- -------------------------------------------------------------

-- 1. Allow users to select their own profile
CREATE POLICY "Users can view their own profile" 
ON public.profiles FOR SELECT 
USING (auth.uid() = id);

-- 2. Allow users to update their own profile
CREATE POLICY "Users can update their own profile" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id);

-- 3. Allow users to insert their own profile
CREATE POLICY "Users can insert their own profile" 
ON public.profiles FOR INSERT 
WITH CHECK (auth.uid() = id);

-- -------------------------------------------------------------
-- Trigger Function to Sync Users to Profiles
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, disability_type, gender, birthdate)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'disability_type', 'None'),
    COALESCE(new.raw_user_meta_data->>'gender', 'Not Specified'),
    CASE 
      WHEN new.raw_user_meta_data->>'birthdate' IS NOT NULL AND new.raw_user_meta_data->>'birthdate' <> '' 
        THEN (new.raw_user_meta_data->>'birthdate')::date
      ELSE NULL
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind the trigger function to fires after a new user inserts into auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

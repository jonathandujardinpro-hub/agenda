import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ffxpposishqquxshfnxj.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmeHBwb3Npc2hxcXV4c2hmbnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMDQ5NjEsImV4cCI6MjEwMjc4MDk2MX0.Z-yti3sWGWlFikgBDRY-GLCAj2_X7ImHDeyiYbsr70A'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Load all data from Supabase
export async function loadData() {
  const { data, error } = await supabase
    .from('agenda_data')
    .select('data')
    .eq('id', 'main')
    .single()
  if (error) { console.error('Load error:', error); return null; }
  return data?.data || {}
}

// Save all data to Supabase
export async function saveData(payload) {
  const { error } = await supabase
    .from('agenda_data')
    .upsert({ id: 'main', data: payload, updated_at: new Date().toISOString() })
  if (error) console.error('Save error:', error)
}
